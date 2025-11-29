import { baseModel } from '../src/config/model.ts';

async function main() {
  console.log('--- Runtime environment variables (relevant) ---');
  console.log('ARK_MODEL =', process.env.ARK_MODEL);
  console.log('ARK_API_KEY =', process.env.ARK_API_KEY ? '***SET***' : 'undefined');
  console.log('ARK_BASE_URL =', process.env.ARK_BASE_URL);
  console.log('OPENAI_API_KEY =', process.env.OPENAI_API_KEY ? '***SET***' : 'undefined');

  console.log('\n--- baseModel internal properties (best-effort) ---');
  // ChatOpenAI implementation may store fields differently; try common property names
  const anyModel = baseModel as any;
  console.log('model property:', anyModel.model ?? anyModel.modelName ?? anyModel);
  console.log('configuration:', anyModel.configuration ?? anyModel.embeddings ?? '(no configuration)');
}

main().catch((e) => { console.error(e); process.exit(1); });
