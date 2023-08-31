import getParser from "./parser"

function parse(input, options) {
  if (options) {

  } else {
    // 获取解析器
    const parser = getParser(options, input)
    console.log(parser)
    // 使用解析器的parse方法将input转化成ast语法树

    const ast = parser.parse()
    // return getParser(options, input).parse();
    // return ast

    return parser
  }
}

export { parse }