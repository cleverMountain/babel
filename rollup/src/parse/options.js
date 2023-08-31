const defaultOptions = {
  sourceType: "script", // 默认script,如果设置为 "module"，则表示代码是 ECMAScript 模块
  sourceFilename: undefined,
  startColumn: 0, // 代码解析的起始列，默认为 0。
  startLine: 1, // 代码解析的起始行，默认为 1。
  allowAwaitOutsideFunction: false, // 是否允许在函数外使用 await 关键字
  allowReturnOutsideFunction: false, // 是否允许在函数外使用 return 语句
  allowNewTargetOutsideFunction: false, // 是否允许在函数外使用 new.target 关键字,指向被调用的构造函数，如果不是则指向undfined
  allowImportExportEverywhere: false, // 是否允许使用import/export es6Module 
  allowSuperOutsideMethod: false, // 是否允许在方法外部使用 super 关键字
  allowUndeclaredExports: false, // 是否允许在没有声明的情况下导出变量或函数
  plugins: [], // 插件
  strictMode: null, // 是否严格模式
  ranges: false, // 是否生成节点范围信息,设置为 true 会在解析器生成的每个节点上添加 start 和 end 属性，表示节点在源代码中的位置信息。
  tokens: false, // 是否生成词法标记信息，设置为 true 会在解析器生成的每个标记上添加 start 和 end 属性，表示标记在源代码中的位置信息。
  createParenthesizedExpressions: false, // 是否创建带括号的表达式节点，默认为 false。设置为 true 会将带括号的表达式解析成单独的节点。
  errorRecovery: false, // 是否在遇到错误时尝试恢复并继续解析，默认为 false。设置为 true 会使解析器尝试恢复并继续解析代码，即使存在语法错误。
  attachComment: true, // 是否将注释附加到解析树节点上，默认为 true。设置为 false 会在解析过程中忽略注释。
  annexB: true
};
// 把选项拿到，如果不传则是默认选项defaultOptions
function getOptions(opts) {
  if (opts == null) {
    return Object.assign({}, defaultOptions);
  }
  // if (opts.annexB != null && opts.annexB !== false) {
  //   throw new Error("The `annexB` option can only be set to `false`.");
  // }
  // const options = {};
  // for (const key of Object.keys(defaultOptions)) {
  //   var _opts$key;
  //   options[key] = (_opts$key = opts[key]) != null ? _opts$key : defaultOptions[key];
  // }
  // return options;
}

export default getOptions