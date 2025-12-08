import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
    cleanup();
    // 清除所有定时器
    vi.clearAllTimers();
    // 重置所有模拟
    vi.resetAllMocks();
});