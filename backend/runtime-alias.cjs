// 运行时路径别名解析：加载 tsconfig.json 中的 @/ 别名，供 dist 产物使用。
// 若 dist 已由构建期解析为相对路径，本文件加载为无害空操作（tsconfig-paths.register 对未命中路径零影响）。
const tsconfigPaths = require('tsconfig-paths');
const tsconfig = require('./tsconfig.json');

tsconfigPaths.register({
  baseUrl: __dirname,
  paths: tsconfig.compilerOptions.paths || {},
});
