export const environmentPolicy = Object.freeze({
  local: Object.freeze({
    branches: Object.freeze(['codex/*']),
    hosted: false,
    data: 'isolated local services and disposable chain state',
  }),
  test: Object.freeze({
    branch: 'test',
    profile: 'test',
    chainId: '46630',
    vercelEnvironment: 'preview',
    aliases: Object.freeze({
      web: 'https://tickergarden-web-test.vercel.app',
      'read-api': 'https://tickergarden-read-api-test.vercel.app',
      pipeline: 'https://tickergarden-pipeline-test.vercel.app',
      content: 'https://tickergarden-content-test.vercel.app',
    }),
  }),
  production: Object.freeze({
    branch: 'master',
    profile: 'master',
    chainId: '4663',
    vercelEnvironment: 'production',
    aliases: Object.freeze({
      web: 'https://tickergarden-web.vercel.app',
      'read-api': 'https://tickergarden-read-api.vercel.app',
      pipeline: 'https://tickergarden-chain-pipeline.vercel.app',
      content: 'https://tickergarden-content.vercel.app',
    }),
  }),
});

export const vercelProjects = Object.freeze({
  web: 'tickergarden-web',
  'read-api': 'tickergarden-read-api',
  pipeline: 'tickergarden-chain-pipeline',
  content: 'tickergarden-content',
});
