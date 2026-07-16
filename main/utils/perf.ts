const startupOrigin = Date.now();

export const mark = (name: string) => {
  console.log(`[perf] ${name}: ${(Date.now() - startupOrigin)}ms`);
};
