import { project_tree } from '../src/utils/tools/project_tree';

(async () => {
  try {
    const res = await project_tree.invoke({ root_path: '.', max_depth: 2, include_hidden: false, include_files: true, max_entries: 500 });
    console.log(res);
  } catch (err: any) {
    console.error('Error invoking project_tree:', err);
    process.exit(1);
  }
})();
