import getOptions from "./options";

class Parser extends StatementParser {
  constructor(options, input) {
    // 获取解析选项, 这里是defaultOptions
    options = getOptions(options);
    console.log(options, 'before')
    // 将defaultOptions及input传入
    super(options, input);
    console.log(options, 'after')
    this.options = options;
    // 初始化作用域
    this.initializeScopes();
    // 插件
    this.plugins = pluginsMap(this.options.plugins);
    this.filename = options.sourceFilename;
  }
  getScopeHandler() {
    return ScopeHandler;
  }
  parse() {
    // 进入初始化作用域
    this.enterInitialScopes();
    const file = this.startNode();
    const program = this.startNode();
    this.nextToken();
    file.errors = null;
    this.parseTopLevel(file, program);
    file.errors = this.state.errors;
    return file;
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