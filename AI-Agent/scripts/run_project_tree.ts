import { project_tree } from '../src/utils/tools/project_tree';
import fs from 'fs/promises';
import path from 'path';

(async () => {
  try {
    const res = await project_tree.invoke({ root_path: '.', max_depth: 0, include_hidden: false, include_files: true, max_entries: 10000 });
    console.log(res.slice(0, 2000));
    await fs.writeFile(path.resolve('project-tree.txt'), res, 'utf8');
    console.log('Wrote project-tree.txt');
  } catch (err: any) {
    console.error('Error invoking project_tree:', err);
    process.exit(1);
  }
})();
