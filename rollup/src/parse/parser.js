// @ts-nocheck
import getOptions from "./options";
import { StatementParser, ScopeHandler } from "./classChain"

function pluginsMap(plugins) {
  // plugins的映射
  const pluginMap = new Map();
  for (const plugin of plugins) {
    const [name, options] = Array.isArray(plugin) ? plugin : [plugin, {}];
    if (!pluginMap.has(name)) pluginMap.set(name, options || {});
  }
  return pluginMap;
}
class Parser extends StatementParser {
  constructor(options, input) {
    // 获取解析选项, 这里是defaultOptions
    options = getOptions(options);
    // 修改options，并获得一些其它属性，init(options)
    /**
     * 通过super继承Tokenizer令牌添加解析器属性
     * tokens: []
     * state:{}
     * input
     * length
     * isLookahead
     * 来自baseParser
     * ambiguousScriptDifferentAst
     * sawUnambiguousESM
     */
    super(options, input);
    this.options = options;
    // 初始化作用域调用UtilParser的initializeScopes方法
    /**
     * 添加解析器其它属性
     * classScope
     * exportedIdentifiers
     * inModule
     * scope
     * prodParam
     * classScope
     * expressionScope
     */
    this.initializeScopes();
    // 插件
    this.plugins = pluginsMap(this.options.plugins);
    this.filename = options.sourceFilename; // 原文件名
  }
  getScopeHandler() {
    return ScopeHandler;
  }
  parse() {
    /**
     * 继承自UtilParser，进入初始化作用域，作用
     * 1.prodParam.stacks.push(PARAM)
     * 2.scope.scopedStack.push(Scope)
     */
    this.enterInitialScopes();
    // Node节点与构造函数Node有关
    const file = this.startNode();
    const program = this.startNode();
    console.log(file)
    // Tokenizer拿到了第一个字符
    this.nextToken();
    file.errors = null;
    this.parseTopLevel(file, program);
    // file.errors = this.state.errors;
    // return file;
  }
}

function getParser(options, input) {
  // 构建解析器实例
  let cls = Parser;
  if (options != null && options.plugins) {
    // validatePlugins(options.plugins);
    // cls = getParserClass(options.plugins);
  }
  return new cls(options, input);
}

export default getParser