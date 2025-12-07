import {
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    ChannelVersions,
    PendingWrite,
    CheckpointTuple,
    CheckpointListOptions
} from "@langchain/langgraph-checkpoint";
import { RunnableConfig } from "@langchain/core/runnables";
import { StorageSystem } from "./index.js";
import { AgentState } from "../agent/state.js";
import { BaseMessage, RemoveMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { CheckpointRecord, SessionMetadata } from "./types.js";

/**
 * LangGraph Checkpointer 适配器
 * 将现有的 StorageSystem 适配到 LangGraph 的 BaseCheckpointSaver 接口
 */
export class LangGraphStorageAdapter extends BaseCheckpointSaver {
    private storage: StorageSystem;

    constructor(storage: StorageSystem) {
        super();
        this.storage = storage;
    }

    /**
     * 将 AgentState 转换为 LangGraph 的 Checkpoint 格式
     */
    private stateToCheckpoint(state: AgentState): Checkpoint {
        return {
            v: 1, // 版本号
            id: uuidv4(),
            ts: new Date().toISOString(),
            channel_values: {
                messages: state.messages,
                summary: state.summary || "",
                projectRoot: state.projectRoot || "",
                projectTreeInjected: state.projectTreeInjected,
                projectTreeText: state.projectTreeText || "",
                projectPlanText: state.projectPlanText || "",
                techStackSummary: state.techStackSummary || "",
                projectInitSteps: state.projectInitSteps || [],
                todos: state.todos || [],
                currentTodoIndex: state.currentTodoIndex || 0,
                pendingFilePaths: state.pendingFilePaths || [],
                taskStatus: state.taskStatus || "planning",
                taskCompleted: state.taskCompleted || false,
                iterationCount: state.iterationCount || 0,
                maxIterations: state.maxIterations || 50,
                pendingToolCalls: state.pendingToolCalls || [],
                error: state.error || "",
                demoMode: state.demoMode || false
            },
            channel_versions: {}, // 可以添加版本控制逻辑
            versions_seen: {}, // 可以添加版本跟踪逻辑
        };
    }

    /**
     * 消息去重：返回只包含新消息的列表
     */
    private deduplicateMessages(messages: BaseMessage[]): BaseMessage[] {
        if (!messages || messages.length <= 1) {
            return messages || [];
        }

        const deduplicated: BaseMessage[] = [];
        const seenIds = new Set<string>();
        const seenContents = new Set<string>();

        for (const message of messages) {
            if (!message) {
                continue;
            }

            const messageId = (message as any).id;
            const messageContent = message.content?.toString() || '';

            // 检查消息ID是否重复
            if (messageId && seenIds.has(messageId)) {
                // console.log(`🔄 跳过重复消息ID: ${messageId}`);
                continue;
            }

            // 检查消息内容是否重复（针对没有ID的情况）
            const contentHash = messageContent.length > 20 ? messageContent.substring(0, 20) : messageContent;
            if (!messageId && seenContents.has(contentHash)) {
                // console.log(`🔄 跳过重复内容: ${messageContent.substring(0, 50)}...`);
                continue;
            }

            if (messageId) {
                seenIds.add(messageId);
            } else {
                seenContents.add(contentHash);
            }

            deduplicated.push(message);
        }

        // console.log(`🧹 消息去重: ${messages.length} -> ${deduplicated.length}`);
        return deduplicated;
    }

    /**
     * 获取真正需要保存的新消息
     */
    private async getNewMessages(
        threadId: string,
        incomingMessages: BaseMessage[]
    ): Promise<BaseMessage[]> {
        // 获取历史记录中已保存的消息ID和内容
        const history = await this.storage.history.getHistory(threadId);
        const savedUserMessages = new Map<string, any>();
        const savedAIMessages = new Map<string, any>();
        const savedToolMessages = new Map<string, any>();

        // 构建已保存消息的映射
        for (const record of history) {
            if (record.event_type === 'user_message') {
                // 用户消息使用内容作为唯一标识（因为用户可能输入相同内容）
                savedUserMessages.set(record.content, record);
            } else if (record.event_type === 'ai_response') {
                // AI消息使用消息ID作为唯一标识，避免空内容被误判为重复
                const messageId = record.metadata?.message_id || record.content;
                savedAIMessages.set(messageId, record);
            } else if (record.event_type === 'tool_call') {
                // 基于工具名和参数创建唯一标识
                const toolName = record.metadata?.tool_name || '';
                const toolArgs = JSON.stringify(record.metadata?.tool_args || {});
                const toolKey = `${toolName}:${toolArgs}`;
                savedToolMessages.set(toolKey, record);
            }
        }

        // 过滤出真正的新消息
        const newMessages: BaseMessage[] = [];
        for (const message of incomingMessages) {
            if (!message) continue;

            const messageType = (message as any).constructor.name ||
                               (message as any)._getType?.() ||
                               (message as any).type;
            const content = message.content?.toString() || '';

            if (messageType === 'HumanMessage' || messageType === 'human') {
                if (!savedUserMessages.has(content)) {
                    newMessages.push(message);
                    // console.log(`🆕 新用户消息: ${content.substring(0, 50)}...`);
                } else {
                    // console.log(`🔄 跳过已保存的用户消息: ${content.substring(0, 50)}...`);
                }
            } else if (messageType === 'AIMessage' || messageType === 'ai') {
                // AI消息使用消息ID来检测重复，而不是内容
                const messageId = (message as any).id;
                if (messageId && !savedAIMessages.has(messageId)) {
                    newMessages.push(message);
                    // console.log(`🆕 新AI回复: ${messageId} - ${content.substring(0, 50)}...`);
                } else if (!messageId && !savedAIMessages.has(content)) {
                    // 如果没有消息ID，回退到使用内容检测
                    newMessages.push(message);
                    // console.log(`🆕 新AI回复 (无ID): ${content.substring(0, 50)}...`);
                } else {
                    // console.log(`🔄 跳过已保存的AI回复: ${messageId || content.substring(0, 50)}...`);
                }
            } else if (messageType === 'ToolMessage' || messageType === 'tool') {
                // 检查工具消息是否已经保存过
                const toolName = (message as any).name || '';
                const toolArgs = JSON.stringify((message as any).tool_result || {});
                const toolKey = `${toolName}:${toolArgs}`;

                if (!savedToolMessages.has(toolKey)) {
                    newMessages.push(message);
                    // console.log(`🆕 新工具消息: ${toolName}...`);
                } else {
                    // console.log(`🔄 跳过已保存的工具消息: ${toolName}...`);
                }
            } else {
                // 其他类型的消息直接保存
                newMessages.push(message);
            }
        }

        return newMessages;
    }

    /**
     * 应用消息Reducer，正确处理添加和删除消息
     * 参考 inject_remove.test.ts 中的逻辑
     */
    private applyMessagesReducer(currentMessages: BaseMessage[], newMessages: any[]): BaseMessage[] {
        const idsToRemove = new Set<string>();
        const result: BaseMessage[] = [...currentMessages];

        for (const msg of newMessages) {
            // 检测是否为 RemoveMessage
            const isRemoveMessage = this.isRemoveMessage(msg);

            if (isRemoveMessage && msg.id) {
                // console.log(`🗑️ 检测到删除消息操作: ID=${msg.id}`);
                idsToRemove.add(msg.id);
                // 从结果中移除已存在的旧消息
                for (let i = result.length - 1; i >= 0; --i) {
                    if (result[i] && result[i].id === msg.id) {
                        // console.log(`🗑️ 删除消息: ${result[i].constructor.name}(${msg.id})`);
                        result.splice(i, 1);
                    }
                }
                continue;
            }

            // 普通消息：如果其 id 在待删集合中，则忽略；否则追加
            if (msg?.id && idsToRemove.has(msg.id)) {
                // console.log(`🔄 跳过已删除的消息: ID=${msg.id}`);
                continue;
            }

            // 确保是 BaseMessage 类型才添加
            if (this.isBaseMessage(msg)) {
                result.push(msg);
                // console.log(`➕ 添加消息: ${msg.constructor.name}(${msg.id || 'no-id'})`);
            } else {
                console.warn(`⚠️ 跳过非 BaseMessage 对象:`, msg?.constructor?.name);
            }
        }

        // console.log(`📊 消息处理结果: ${currentMessages.length} -> ${result.length} (删除了 ${idsToRemove.size} 条消息)`);
        return result;
    }

    /**
     * 检测消息是否为 RemoveMessage
     */
    private isRemoveMessage(message: any): message is RemoveMessage {
        if (!message) return false;

        // 多种检测方式，确保能正确识别 RemoveMessage
        const constructorName = message?.constructor?.name;
        const hasId = message?.id;
        const isRemoveType = message?.type === 'remove';

        // 检查是否是 RemoveMessage 的实例
        if (message instanceof RemoveMessage) {
            return true;
        }

        // 检查构造函数名
        if (constructorName === 'RemoveMessage') {
            return true;
        }

        // 检查类型标记
        if (isRemoveType && hasId) {
            return true;
        }

        return false;
    }

    /**
     * 检测消息是否为 BaseMessage
     */
    private isBaseMessage(message: any): message is BaseMessage {
        if (!message) return false;

        // 检查是否是 RemoveMessage（这不应该被当作 BaseMessage）
        if (this.isRemoveMessage(message)) {
            return false;
        }

        // 检查是否是 BaseMessage 的实例
        if (message instanceof BaseMessage) {
            return true;
        }

        // 检查是否有 BaseMessage 的关键属性
        const hasContent = 'content' in message;
        const hasTypeMethod = typeof message._getType === 'function' ||
                             typeof message.getType === 'function' ||
                             typeof message.type === 'string';

        return hasContent && hasTypeMethod;
    }

    /**
     * 获取消息类型字符串
     */
    private getMessageType(message: BaseMessage): string {
        try {
            // 尝试多种方式获取消息类型
            const directType = (message as any).type;
            if (directType && typeof directType === 'string') {
                return directType.toLowerCase();
            }

            const getTypeMethod = (message as any)._getType?.();
            if (getTypeMethod && typeof getTypeMethod === 'string') {
                return getTypeMethod.toLowerCase();
            }

            const constructorName = (message as any).constructor.name;
            if (constructorName && typeof constructorName === 'string') {
                return constructorName.toLowerCase();
            }

            // 处理特殊情况：constructor.name 可能是数组形式
            const constructorId = (message as any).constructor.id;
            if (Array.isArray(constructorName) && constructorId) {
                // 提取最后的类型名称，如 ["langchain_core","messages","HumanMessage"] -> "humanmessage"
                return constructorId.toString().toLowerCase();
            }

            // 检查消息的内容和属性来判断类型
            const content = message.content?.toString() || '';
            const hasToolCalls = (message as any).tool_calls && Array.isArray((message as any).tool_calls);
            const hasName = (message as any).name;

            if (hasToolCalls) {
                return 'aimessage'; // 带工具调用的AI消息
            } else if (hasName) {
                return 'toolmessage'; // 工具消息
            } else if (content && !hasToolCalls && !hasName) {
                // 根据内容来源判断（简单的启发式方法）
                return content.includes('吗？') || content.includes('可以帮助') || content.includes('我可以') ? 'aimessage' : 'humanmessage';
            }

            console.warn(`⚠️ 无法确定消息类型，使用默认类型:`, {
                type: directType,
                getType: getTypeMethod,
                constructor: constructorName,
                constructorId: constructorId,
                content: content.substring(0, 50) + (content.length > 50 ? '...' : '')
            });

            return 'unknown'; // 默认未知类型

        } catch (error) {
            console.warn(`⚠️ 消息类型检测失败:`, error);
            return 'unknown';
        }
    }

    /**
     * 保存消息历史记录到 HistoryManager
     */
    private async saveMessagesToHistory(
        threadId: string,
        messages: BaseMessage[],
        _previousMessageCount = 0
    ): Promise<void> {
        if (!messages || messages.length === 0) {
            return;
        }

        // 先去重
        const deduplicatedMessages = this.deduplicateMessages(messages);
        if (deduplicatedMessages.length === 0) {
            return;
        }

        // 获取真正需要保存的新消息
        const newMessages = await this.getNewMessages(threadId, deduplicatedMessages);

        if (newMessages.length === 0) {
            // console.log(`💾 没有新消息需要保存`);
            return;
        }

        // console.log(`💾 保存历史记录: 准备保存 ${newMessages.length} 条新消息 (总消息数: ${deduplicatedMessages.length})`);

        for (const message of newMessages) {
            try {
                if (!message) {
                    console.warn(`⚠️ 跳过空消息`);
                    continue;
                }

                // 使用改进的消息类型检测
                const messageType = this.getMessageType(message);
                const messageId = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // 跳过未知类型的消息，但允许有工具调用的消息（即使content为空）
                if (messageType === 'unknown') {
                    console.warn(`⚠️ 跳过未知类型的消息:`, {
                        type: messageType,
                        content: message.content,
                        id: messageId
                    });
                    continue;
                }

                // 对于有工具调用的消息，即使content为空也要保存
                const hasToolCalls = (message as any).tool_calls && Array.isArray((message as any).tool_calls);
                if (!message.content && !hasToolCalls) {
                    // console.warn(`⚠️ 跳过空内容且无工具调用的消息:`, {
                    //     type: messageType,
                    //     content: message.content,
                    //     id: messageId
                    // });
                    continue;
                }

                if (messageType === 'humanmessage' || messageType === 'human') {
                    // 用户消息 - 高优先级
                    // console.log(`👤 保存用户消息: ${message.content?.toString().substring(0, 50)}...`);
                    await this.storage.history.addHistoryRecord(threadId, {
                        event_type: 'user_message',
                        content: message.content as string,
                        display_priority: 'high',
                        metadata: {
                            message_id: messageId,
                            additional_kwargs: message.additional_kwargs
                        }
                    });

                    // 检查是否是第一条用户消息，如果是则生成智能标题
                    // 在添加用户消息到历史记录后，检查历史记录中的用户消息数量
                    const updatedUserHistory = await this.storage.history.getHistory(threadId, {
                        eventType: 'user_message',
                        limit: 1 // 获取第一条用户消息
                    });

                    // 如果历史记录中只有一条用户消息（即当前刚保存的这条），生成智能标题
                    if (updatedUserHistory.length === 1) {
                        try {
                            // console.log(`🎯 检测到第一条用户消息，开始生成智能标题...`);
                            await this.storage.sessions.generateSessionTitle(threadId);
                            // console.log(`✨ 生成的智能标题: ${smartTitle}`);
                        } catch (titleError) {
                            console.warn(`⚠️ 生成智能标题失败:`, titleError);
                            // 不影响主要功能，继续执行
                        }
                    }
                } else if (messageType === 'aimessage' || messageType === 'ai') {
                    // AI 响应 - 高优先级
                    const messageContent = message.content?.toString() || '';
                    // const hasToolCalls = (message as any).tool_calls && Array.isArray((message as any).tool_calls);
                    //
                    // // 为 AI 消息选择合适的内容描述
                    // let displayContent = messageContent;
                    // if (!messageContent && hasToolCalls) {
                    //     displayContent = "AI 工具调用请求（无文本内容）";
                    // }

                    // console.log(`🤖 保存AI回复: ${displayContent.substring(0, 50)}...`);
                    await this.storage.history.addHistoryRecord(threadId, {
                        event_type: 'ai_response',
                        content: messageContent,
                        display_priority: 'high',
                        metadata: {
                            message_id: messageId,
                            tool_calls: (message as any).tool_calls,
                            response_metadata: (message as any).response_metadata
                        }
                    });

                    // 工具调用请求不再记录到历史中，只记录工具执行结果
                    // 注释掉工具调用请求的记录代码，避免产生"调用工具: xxx"的无用消息
                    // const toolCalls = (message as any).tool_calls;
                    // if (toolCalls && Array.isArray(toolCalls)) {
                    //     for (const toolCall of toolCalls) {
                    //         try {
                    //             await this.storage.history.addHistoryRecord(threadId, {
                    //                 event_type: 'tool_call',
                    //                 content: `调用工具: ${toolCall.function?.name || toolCall.name}`,
                    //                 display_priority: 'medium',
                    //                 metadata: {
                    //                     tool_name: toolCall.function?.name || toolCall.name,
                    //                     tool_args: toolCall.function?.arguments || toolCall.args,
                    //                     tool_call_id: toolCall.id
                    //                 }
                    //             });
                    //         } catch (toolError) {
                    //             console.warn(`⚠️ 保存工具调用记录失败:`, toolError);
                    //         }
                    //     }
                    // }
                } else if (messageType === 'toolmessage' || messageType === 'tool') {
                    // 工具消息 - 中优先级
                    await this.storage.history.addHistoryRecord(threadId, {
                        event_type: 'tool_call',
                        content: `工具执行结果: ${(message as any).name}`,
                        display_priority: 'medium',
                        metadata: {
                            tool_name: (message as any).name,
                            tool_call_id: (message as any).tool_call_id,
                            tool_result: (message as any).content,
                            status: (message as any).status,
                            additional_kwargs: (message as any).additional_kwargs
                        }
                    });
                } else {
                    // 其他有效类型的消息 - 中优先级（但不保存无效的Object类型）
                    // console.log(`📝 保存其他类型消息 (${messageType}): ${message.content?.toString().substring(0, 50)}...`);
                    if (message.content && message.content.toString().trim() !== '') {
                        await this.storage.history.addHistoryRecord(threadId, {
                            event_type: 'ai_response',
                            content: message.content as string,
                            display_priority: 'medium',
                            metadata: {
                                message_id: messageId,
                                message_type: messageType
                            }
                        });
                    } else {
                        console.warn(`⚠️ 跳过空内容的其他类型消息:`, messageType);
                    }
                }

                // 处理其他系统事件类型
                if (messageType === 'error') {
                    // 错误事件 - 高优先级
                    await this.storage.history.addHistoryRecord(threadId, {
                        event_type: 'error',
                        content: message.content as string,
                        display_priority: 'high',
                        metadata: {
                            message_id: messageId,
                            message_type: messageType
                        }
                    });
                } else if (messageType === 'session_created' || messageType === 'system_summarize') {
                    // 系统事件 - 低优先级
                    await this.storage.history.addHistoryRecord(threadId, {
                        event_type: messageType,
                        content: message.content as string,
                        display_priority: 'low',
                        metadata: {
                            message_id: messageId,
                            message_type: messageType
                        }
                    });
                }
            } catch (messageError) {
                console.warn(`⚠️ 保存消息历史记录失败:`, messageError);
                // 继续处理下一个消息，不要中断整个流程
            }
        }
    }

    /**
     * 将 LangGraph Checkpoint 转换回 AgentState
     */
    private checkpointToState(checkpoint: Checkpoint): AgentState {
        const values = checkpoint.channel_values;
        return {
            messages: values.messages as BaseMessage[] || [],
            summary: values.summary as string || "",
            projectRoot: values.projectRoot as string || "",
            projectTreeInjected: values.projectTreeInjected as boolean || false,
            projectTreeText: values.projectTreeText as string || "",
            projectPlanText: values.projectPlanText as string || "",
            techStackSummary: values.techStackSummary as string || "",
            projectInitSteps: values.projectInitSteps as string[] || [],
            todos: values.todos as string[] || [],
            currentTodoIndex: values.currentTodoIndex as number || 0,
            pendingFilePaths: values.pendingFilePaths as string[] || [],
            taskStatus: values.taskStatus as "planning" | "executing" | "completed" || "planning",
            taskCompleted: values.taskCompleted as boolean || false,
            iterationCount: values.iterationCount as number || 0,
            maxIterations: values.maxIterations as number || 50,
            pendingToolCalls: values.pendingToolCalls as any[] || [],
            error: values.error as string || "",
            demoMode: values.demoMode as boolean || false
        };
    }

    /**
     * 从 RunnableConfig 提取 thread_id
     */
    private getThreadId(config: RunnableConfig): string {
        const threadId = config.configurable?.thread_id;
        if (!threadId || typeof threadId !== 'string' || threadId.trim() === '') {
            console.warn(`⚠️ 无效的 threadId: ${threadId}，使用默认值 "default"`);
            return "default";
        }
        return threadId.trim();
    }

    /**
     * 保存检查点 - 必须返回 RunnableConfig
     */
    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        _metadata: CheckpointMetadata,
        _newVersions: ChannelVersions
    ): Promise<RunnableConfig> {
        const threadId = this.getThreadId(config);
        const state = this.checkpointToState(checkpoint);

        try {
            // 检查是否已有会话（使用传入的 threadId）
            let sessionInfo = await this.storage.sessions.getSessionInfo(threadId);

            if (!sessionInfo) {
                // console.log(`🔧 为 threadId ${threadId} 创建新会话`);
                // 直接使用传入的 threadId，而不是让 createSession 生成新ID
                const now = Date.now();
                const metadata: SessionMetadata = {
                    thread_id: threadId,
                    title: `LangGraph Session ${threadId}`,
                    created_at: now,
                    updated_at: now,
                    message_count: 0,
                    status: 'active',
                };

                // 直接写入元数据文件，使用传入的 threadId
                await this.storage.files.writeMetadata(threadId, metadata);
                sessionInfo = {
                    metadata,
                    hasActiveCheckpoint: false,
                    checkpointCount: 0,
                    historyCount: 0
                };
                // console.log(`✅ 会话创建成功: ${threadId}`);
            }
            else {
                // console.log(`📋 使用现有会话: ${threadId}`);
                const metadata1 = sessionInfo.metadata
                // 自动激活归档会话 - 添加空值检查防止错误
                if (metadata1 && metadata1.status === 'archived') {
                    // console.log(`🔄 自动激活归档会话: ${threadId}`);
                    await this.storage.sessions.restoreSession(threadId);
                }
            }

            // 获取之前的消息数量，用于确定哪些是新增消息
            // 这里需要获取之前已经存储的消息数量，而不是当前状态的消息数量
            const previousHistory = await this.storage.history.getHistory(threadId);
            const userMessages = previousHistory.filter(record => record.event_type === 'user_message');
            const aiMessages = previousHistory.filter(record => record.event_type === 'ai_response');
            const previousMessageCount = userMessages.length + aiMessages.length;

            // 直接使用文件管理器保存检查点，避免通过 SessionManager.saveCheckpoint
            // console.log(`💾 直接保存检查点: ${checkpoint.id}`);
            await this.storage.files.appendCheckpoint(threadId, {
                timestamp: Date.now(),
                thread_id: threadId,
                checkpoint: {
                    id: checkpoint.id,
                    step: _metadata?.step || 1,
                    channel_values: state
                }
            });

            // 保存新增的消息到历史记录
            if (state.messages && state.messages.length > 0) {
                await this.saveMessagesToHistory(threadId, state.messages, previousMessageCount);
            }

            // 直接更新会话元数据文件
            // console.log(`📝 更新会话元数据`);
            const existingMetadata = await this.storage.files.readMetadata(threadId);
            if (existingMetadata) {
                const updatedMetadata = {
                    ...existingMetadata,
                    last_checkpoint: checkpoint.id,
                    updated_at: Date.now(),
                    message_count: state.messages ? state.messages.length : 0
                };
                await this.storage.files.writeMetadata(threadId, updatedMetadata);
                // console.log(`✅ 会话元数据更新成功，消息数量: ${updatedMetadata.message_count}`);
            } else {
                console.warn(`⚠️ 会话元数据不存在，跳过更新`);
            }
        } catch (error) {
            console.error(`❌ 保存检查点失败:`, error);
            throw error;
        }

        // 返回配置（LangGraph 要求返回配置）
        return config;
    }

    /**
     * 保存写入操作（用于增量更新）
     */
    async putWrites(
        config: RunnableConfig,
        writes: PendingWrite[],
        _taskId: string
    ): Promise<void> {
        const threadId = this.getThreadId(config);

        try {
            // 获取最新检查点
            const latestCheckpoint = await this.storage.checkpoints.getLatestCheckpoint(threadId);

            let currentState: AgentState;
            let currentStep = 0;
            let parentId = "__root__";

            if (latestCheckpoint) {
                // 使用现有检查点状态
                currentState = latestCheckpoint.checkpoint.channel_values as AgentState;
                currentStep = latestCheckpoint.checkpoint.step || 0;
                parentId = latestCheckpoint.checkpoint.id;
            } else {
                // 如果没有检查点，创建初始状态
                currentState = {
                    messages: [],
                    summary: "",
                    projectRoot: process.cwd(),
                    projectTreeInjected: false,
                    projectTreeText: "",
                    projectPlanText: "",
                    techStackSummary: "",
                    projectInitSteps: [],
                    todos: [],
                    currentTodoIndex: 0,
                    pendingFilePaths: [],
                    taskStatus: "planning" as const,
                    taskCompleted: false,
                    iterationCount: 0,
                    maxIterations: 50,
                    pendingToolCalls: [],
                    error: "",
                    demoMode: false
                };
            }

            const updatedState = { ...currentState };

            // 将写入操作应用到状态
            for (const [channel, value] of writes) {
                if (channel === "messages" && Array.isArray(value)) {
                    // console.log(`🔄 处理消息写入: 接收到 ${value.length} 条消息 (包含可能的 RemoveMessage)`);

                    // 🔑 关键修改：使用新的消息Reducer处理添加和删除
                    const processedMessages = this.applyMessagesReducer(updatedState.messages, value);
                    updatedState.messages = processedMessages;

                    // console.log(`📝 消息处理完成: 最终状态包含 ${updatedState.messages.length} 条消息`);
                } else {
                    // 更新其他通道值
                    (updatedState as any)[channel] = value;
                }
            }

            // 构建完整的 CheckpointMetadata
            const metadata: CheckpointMetadata = {
                source: "update", // 操作来源：更新操作
                step: currentStep + 1, // 步骤递增
                parents: {
                    // 父检查点 ID 映射
                    __root__: parentId
                }
            };

            // 直接保存检查点，避免递归调用 put 方法
            await this.saveCheckpointDirectly(threadId, updatedState, metadata);
        } catch (error) {
            console.error(`❌ 保存写入操作失败:`, error);
            throw error;
        }
    }

    /**
     * 直接保存检查点，避免递归调用
     */
    private async saveCheckpointDirectly(
        threadId: string,
        state: AgentState,
        metadata: CheckpointMetadata
    ): Promise<void> {
        const checkpoint = this.stateToCheckpoint(state);

        // 确保会话存在
        const sessionInfo = await this.storage.sessions.getSessionInfo(threadId);
        if (!sessionInfo) {
            // console.log(`🔧 在 putWrites 中为 threadId ${threadId} 创建新会话`);
            const now = Date.now();
            const sessionMetadata: SessionMetadata = {
                thread_id: threadId,
                title: `LangGraph Session ${threadId}`,
                created_at: now,
                updated_at: now,
                message_count: 0,
                status: 'active',
            };
            await this.storage.files.writeMetadata(threadId, sessionMetadata);
        } else {
            const metadata = sessionInfo.metadata;
            // 自动激活归档会话
            if (metadata.status === 'archived') {
                // console.log(`🔄 自动激活归档会话 (putWrites): ${threadId}`);
                await this.storage.sessions.restoreSession(threadId);
            }
        }

        // 直接保存检查点
        // console.log(`💾 直接保存检查点 (putWrites): ${checkpoint.id}`);
        await this.storage.files.appendCheckpoint(threadId, {
            timestamp: Date.now(),
            thread_id: threadId,
            checkpoint: {
                id: checkpoint.id,
                step: metadata.step || 1,
                channel_values: state
            }
        });

        // 更新会话元数据
        const existingMetadata = await this.storage.files.readMetadata(threadId);
        if (existingMetadata) {
            // 计算实际的消息数量（去除重复消息）
        const deduplicatedMessages = this.deduplicateMessages(state.messages || []);
        const actualMessageCount = deduplicatedMessages.length;

        const updatedMetadata = {
                ...existingMetadata,
                last_checkpoint: checkpoint.id,
                updated_at: Date.now(),
                message_count: actualMessageCount
            };
            await this.storage.files.writeMetadata(threadId, updatedMetadata);
            // console.log(`✅ 会话元数据更新成功 (putWrites)`);
        }
    }

    /**
     * 获取检查点元组（包含待处理写入）
     */
    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const threadId = this.getThreadId(config);

        let checkpoint: CheckpointRecord | null;

        if (config.configurable?.checkpoint_id) {
            // 获取特定检查点
            checkpoint = await this.storage.checkpoints.getCheckpoint(threadId, config.configurable.checkpoint_id);
        } else {
            // 获取最新检查点
            checkpoint = await this.storage.checkpoints.getLatestCheckpoint(threadId);
        }

        if (!checkpoint) {
            return undefined;
        }

        const checkpointData = checkpoint.checkpoint;

        return {
            config,
            checkpoint: {
                v: 1,
                id: checkpointData.id,
                ts: new Date().toISOString(),
                channel_values: checkpointData.channel_values as unknown as Record<string, unknown>,
                channel_versions: {},
                versions_seen: {}
            },
            metadata: {
                step: checkpointData.step || 0,
                source: "loop",
                parents: {}
            },
            pendingWrites: [], // LangGraph 要求的字段
            parentConfig: undefined // 可以添加父检查点引用
        };
    }

    /**
     * 列出检查点（异步生成器）
     */
    async* list(
        config: RunnableConfig,
        options?: CheckpointListOptions
    ): AsyncGenerator<CheckpointTuple> {
        const threadId = this.getThreadId(config);

        // 获取会话的所有检查点
        const sessionInfo = await this.storage.sessions.getSessionInfo(threadId);
        if (!sessionInfo || sessionInfo.checkpointCount === 0) {
            return;
        }

        // 使用 FileManager 读取所有检查点
        const checkpoints = await this.storage.files.readCheckpoints(threadId);

        let count = 0;
        // 反向遍历，最新的检查点在前
        for (let i = checkpoints.length - 1; i >= 0; i--) {
            const checkpointRecord = checkpoints[i];

            if (options?.limit && count >= options.limit) break;
            if (options?.before) {
                // before 参数是 RunnableConfig，需要提取其中的 checkpoint_id
                try {
                    const beforeConfig = options.before;
                    const beforeCheckpointId = beforeConfig.configurable?.checkpoint_id;

                    if (beforeCheckpointId) {
                        // 获取目标检查点的时间戳进行比较
                        const targetCheckpoint = await this.storage.checkpoints.getCheckpoint(threadId, beforeCheckpointId);
                        if (targetCheckpoint) {
                            const targetTimestamp = targetCheckpoint.timestamp || 0;
                            const currentTimestamp = checkpointRecord.timestamp || 0;

                            // 如果当前检查点的时间戳早于或等于目标检查点，跳过
                            if (currentTimestamp <= targetTimestamp) {
                                continue;
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`比较检查点时间戳时出错 (checkpoint: ${checkpointRecord.checkpoint.id}):`, error);
                    // 如果比较失败，保守地包含该检查点
                }
            }

            try {
                const checkpointData = checkpointRecord.checkpoint;
                const tuple: CheckpointTuple = {
                    config: { ...config, configurable: { ...config.configurable, checkpoint_id: checkpointData.id } },
                    checkpoint: {
                        v: 1,
                        id: checkpointData.id,
                        ts: new Date().toISOString(),
                        channel_values: checkpointData.channel_values as unknown as Record<string, unknown>,
                        channel_versions: {},
                        versions_seen: {}
                    },
                    metadata: {
                        step: checkpointData.step || 0,
                        source: "loop",
                        parents: {}
                    },
                    pendingWrites: [],
                    parentConfig: undefined
                };
                yield tuple;
                count++;
            } catch (error) {
                // 跳过损坏的检查点
                console.warn(`跳过损坏的检查点: ${checkpointRecord.checkpoint.id}`, error);
            }
        }
    }

    /**
     * 删除指定线程的所有检查点
     */
    async deleteThread(threadId: string): Promise<void> {
        // 使用存储系统的删除功能
        await this.storage.sessions.deleteSession(threadId);
    }

    /**
     * 获取下一个版本号（使用数字版本）
     */
    getNextVersion(current?: number): number {
        return (current || 0) + 1;
    }
}

/**
 * 创建 LangGraph 存储适配器的便捷函数
 */
export function createLangGraphAdapter(storage?: StorageSystem): LangGraphStorageAdapter {
    const storageSystem = storage || new StorageSystem();
    return new LangGraphStorageAdapter(storageSystem);
}
