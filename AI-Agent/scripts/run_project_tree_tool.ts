import { project_tree } from '../src/utils/tools/project_tree';

async function run() {
  try {
    const res = await project_tree.invoke({ root_path: '.', max_depth: 2, include_hidden: false, include_files: true, max_entries: 200 });
    console.log('project_tree.invoke result:\n', res);
  } catch (err) {
    console.error('Error calling project_tree.invoke:', err);
  }
}

run();
