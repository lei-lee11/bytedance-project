import * as nodes from '../src/agent/nodes';

async function run() {
  const mockState: any = {
    messages: [],
    projectRoot: '.',
    projectTreeInjected: false,
  };

  console.log('module exports:', Object.keys(nodes));
  console.log('module exports:', Object.keys(nodes));
  console.dir(nodes, { depth: 2 });
  try {
    if (typeof (nodes as any).injectProjectTreeNode !== 'function') {
      console.error('injectProjectTreeNode not exported from nodes module');
      return;
    }
    const res = await (nodes as any).injectProjectTreeNode(mockState);
    console.log('injectProjectTreeNode result:', res);
  } catch (err) {
    console.error('Error calling injectProjectTreeNode:', err);
  }
}

run();
