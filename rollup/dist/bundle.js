(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.babel = factory());
})(this, (function () { 'use strict';

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

  // @ts-nocheck
  class Scope {
    constructor(flags) {
      this.var = new Set();
      // lexical 词法
      this.lexical = new Set();
      this.functions = new Set();
      this.flags = flags;
    }
  }
  const PARAM = 0b0000,  // 0b代表二进制  0000 表示0,我们用的都是10进制
    PARAM_YIELD = 0b0001, // 1
    PARAM_AWAIT = 0b0010, // 2
    PARAM_RETURN = 0b0100, // 4
    PARAM_IN = 0b1000; // 8
  class ExpressionScope {
    constructor(type = 0) {
      this.type = type;
    }
    canBeArrowParameterDeclaration() {
      return this.type === 2 || this.type === 1;
    }
    isCertainlyParameterDeclaration() {
      return this.type === 3;
    }
  }
  // 处理表达式
  class ExpressionScopeHandler {
    constructor(parser) {
      this.parser = void 0;
      this.stack = [new ExpressionScope()];
      this.parser = parser;
    }
    enter(scope) {
      this.stack.push(scope);
    }
    exit() {
      this.stack.pop();
    }
    recordParameterInitializerError(toParseError, {
      at: node
    }) {
      const origin = {
        at: node.loc.start
      };
      const {
        stack
      } = this;
      let i = stack.length - 1;
      let scope = stack[i];
      while (!scope.isCertainlyParameterDeclaration()) {
        if (scope.canBeArrowParameterDeclaration()) {
          scope.recordDeclarationError(toParseError, origin);
        } else {
          return;
        }
        scope = stack[--i];
      }
      this.parser.raise(toParseError, origin);
    }
    recordArrowParameterBindingError(error, {
      at: node
    }) {
      const {
        stack
      } = this;
      const scope = stack[stack.length - 1];
      const origin = {
        at: node.loc.start
      };
      if (scope.isCertainlyParameterDeclaration()) {
        this.parser.raise(error, origin);
      } else if (scope.canBeArrowParameterDeclaration()) {
        scope.recordDeclarationError(error, origin);
      } else {
        return;
      }
    }
    recordAsyncArrowParametersError({
      at
    }) {
      const {
        stack
      } = this;
      let i = stack.length - 1;
      let scope = stack[i];
      while (scope.canBeArrowParameterDeclaration()) {
        if (scope.type === 2) {
          scope.recordDeclarationError(Errors.AwaitBindingIdentifier, {
            at
          });
        }
        scope = stack[--i];
      }
    }
    validateAsPattern() {
      const {
        stack
      } = this;
      const currentScope = stack[stack.length - 1];
      if (!currentScope.canBeArrowParameterDeclaration()) return;
      currentScope.iterateErrors(([toParseError, loc]) => {
        this.parser.raise(toParseError, {
          at: loc
        });
        let i = stack.length - 2;
        let scope = stack[i];
        while (scope.canBeArrowParameterDeclaration()) {
          scope.clearDeclarationError(loc.index);
          scope = stack[--i];
        }
      });
    }
  }
  // 处理类
  class ClassScopeHandler {
    constructor(parser) {
      this.parser = void 0;
      this.stack = [];
      this.undefinedPrivateNames = new Map();
      this.parser = parser;
    }
    current() {
      return this.stack[this.stack.length - 1];
    }
    enter() {
      this.stack.push(new ClassScope());
    }
    exit() {
      const oldClassScope = this.stack.pop();
      const current = this.current();
      for (const [name, loc] of Array.from(oldClassScope.undefinedPrivateNames)) {
        if (current) {
          if (!current.undefinedPrivateNames.has(name)) {
            current.undefinedPrivateNames.set(name, loc);
          }
        } else {
          this.parser.raise(Errors.InvalidPrivateFieldResolution, {
            at: loc,
            identifierName: name
          });
        }
      }
    }
    declarePrivateName(name, elementType, loc) {
      const {
        privateNames,
        loneAccessors,
        undefinedPrivateNames
      } = this.current();
      let redefined = privateNames.has(name);
      if (elementType & 3) {
        const accessor = redefined && loneAccessors.get(name);
        if (accessor) {
          const oldStatic = accessor & 4;
          const newStatic = elementType & 4;
          const oldKind = accessor & 3;
          const newKind = elementType & 3;
          redefined = oldKind === newKind || oldStatic !== newStatic;
          if (!redefined) loneAccessors.delete(name);
        } else if (!redefined) {
          loneAccessors.set(name, elementType);
        }
      }
      if (redefined) {
        this.parser.raise(Errors.PrivateNameRedeclaration, {
          at: loc,
          identifierName: name
        });
      }
      privateNames.add(name);
      undefinedPrivateNames.delete(name);
    }
    usePrivateName(name, loc) {
      let classScope;
      for (classScope of this.stack) {
        if (classScope.privateNames.has(name)) return;
      }
      if (classScope) {
        classScope.undefinedPrivateNames.set(name, loc);
      } else {
        this.parser.raise(Errors.InvalidPrivateFieldResolution, {
          at: loc,
          identifierName: name
        });
      }
    }
  }
  class ProductionParameterHandler {
    constructor() {
      this.stacks = [];
    }
    enter(flags) {
      this.stacks.push(flags);
    }
    exit() {
      this.stacks.pop();
    }
    currentFlags() {
      return this.stacks[this.stacks.length - 1];
    }
    get hasAwait() {
      return (this.currentFlags() & PARAM_AWAIT) > 0;
    }
    get hasYield() {
      return (this.currentFlags() & PARAM_YIELD) > 0;
    }
    get hasReturn() {
      return (this.currentFlags() & PARAM_RETURN) > 0;
    }
    get hasIn() {
      return (this.currentFlags() & PARAM_IN) > 0;
    }
  }

  // 处理作用域
  class ScopeHandler {
    constructor(parser, inModule) {
      this.parser = void 0;
      this.scopeStack = [];
      this.inModule = void 0;
      this.undefinedExports = new Map();
      this.parser = parser;
      this.inModule = inModule;
    }
    get inTopLevel() {
      return (this.currentScope().flags & 1) > 0;
    }
    get inFunction() {
      return (this.currentVarScopeFlags() & 2) > 0;
    }
    get allowSuper() {
      return (this.currentThisScopeFlags() & 16) > 0;
    }
    get allowDirectSuper() {
      return (this.currentThisScopeFlags() & 32) > 0;
    }
    get inClass() {
      return (this.currentThisScopeFlags() & 64) > 0;
    }
    get inClassAndNotInNonArrowFunction() {
      const flags = this.currentThisScopeFlags();
      return (flags & 64) > 0 && (flags & 2) === 0;
    }
    get inStaticBlock() {
      for (let i = this.scopeStack.length - 1;; i--) {
        const {
          flags
        } = this.scopeStack[i];
        if (flags & 128) {
          return true;
        }
        if (flags & (387 | 64)) {
          return false;
        }
      }
    }
    get inNonArrowFunction() {
      return (this.currentThisScopeFlags() & 2) > 0;
    }
    get treatFunctionsAsVar() {
      return this.treatFunctionsAsVarInScope(this.currentScope());
    }
    createScope(flags) {
      // 获取scoped
      return new Scope(flags);
    }
    // 作用域处理mark2
    enter(flags) {
      /**
       * createScope
       * flags: 1
       * functions: Set(0) {size: 0}
       * lexical: Set(0) {size: 0}
       * var: Set(0) {size: 0}
       */
      // 压入scoped
      this.scopeStack.push(this.createScope(flags));
    }
    exit() {
      const scope = this.scopeStack.pop();
      return scope.flags;
    }
    treatFunctionsAsVarInScope(scope) {
      return !!(scope.flags & (2 | 128) || !this.parser.inModule && scope.flags & 1);
    }
    declareName(name, bindingType, loc) {
      let scope = this.currentScope();
      if (bindingType & 8 || bindingType & 16) {
        this.checkRedeclarationInScope(scope, name, bindingType, loc);
        if (bindingType & 16) {
          scope.functions.add(name);
        } else {
          scope.lexical.add(name);
        }
        if (bindingType & 8) {
          this.maybeExportDefined(scope, name);
        }
      } else if (bindingType & 4) {
        for (let i = this.scopeStack.length - 1; i >= 0; --i) {
          scope = this.scopeStack[i];
          this.checkRedeclarationInScope(scope, name, bindingType, loc);
          scope.var.add(name);
          this.maybeExportDefined(scope, name);
          if (scope.flags & 387) break;
        }
      }
      if (this.parser.inModule && scope.flags & 1) {
        this.undefinedExports.delete(name);
      }
    }
    maybeExportDefined(scope, name) {
      if (this.parser.inModule && scope.flags & 1) {
        this.undefinedExports.delete(name);
      }
    }
    checkRedeclarationInScope(scope, name, bindingType, loc) {
      if (this.isRedeclaredInScope(scope, name, bindingType)) {
        this.parser.raise(Errors.VarRedeclaration, {
          at: loc,
          identifierName: name
        });
      }
    }
    isRedeclaredInScope(scope, name, bindingType) {
      if (!(bindingType & 1)) return false;
      if (bindingType & 8) {
        return scope.lexical.has(name) || scope.functions.has(name) || scope.var.has(name);
      }
      if (bindingType & 16) {
        return scope.lexical.has(name) || !this.treatFunctionsAsVarInScope(scope) && scope.var.has(name);
      }
      return scope.lexical.has(name) && !(scope.flags & 8 && scope.lexical.values().next().value === name) || !this.treatFunctionsAsVarInScope(scope) && scope.functions.has(name);
    }
    checkLocalExport(id) {
      const {
        name
      } = id;
      const topLevelScope = this.scopeStack[0];
      if (!topLevelScope.lexical.has(name) && !topLevelScope.var.has(name) && !topLevelScope.functions.has(name)) {
        this.undefinedExports.set(name, id.loc.start);
      }
    }
    currentScope() {
      return this.scopeStack[this.scopeStack.length - 1];
    }
    currentVarScopeFlags() {
      for (let i = this.scopeStack.length - 1;; i--) {
        const {
          flags
        } = this.scopeStack[i];
        if (flags & 387) {
          return flags;
        }
      }
    }
    currentThisScopeFlags() {
      for (let i = this.scopeStack.length - 1;; i--) {
        const {
          flags
        } = this.scopeStack[i];
        if (flags & (387 | 64) && !(flags & 4)) {
          return flags;
        }
      }
    }
  }
  // 位置信息
  class Position {
    constructor(line, col, index) {
      this.line = void 0;
      this.column = void 0;
      this.index = void 0;
      this.line = line;
      this.column = col;
      this.index = index;
    }
  }
  // token令牌内容
  class TokContext {
    constructor(token, preserveSpace) {
      this.token = void 0;
      this.preserveSpace = void 0;
      this.token = token;
      this.preserveSpace = !!preserveSpace;
    }
  }
  const types = {
    brace: new TokContext("{"),
    j_oTag: new TokContext("<tag"),
    j_cTag: new TokContext("</tag"),
    j_expr: new TokContext("<tag>...</tag>", true),
    template: new TokContext("`", true)
  };
  class State {
    constructor() {
      this.strict = void 0;
      this.curLine = void 0;
      this.lineStart = void 0;
      this.startLoc = void 0;
      this.endLoc = void 0;
      this.errors = [];
      this.potentialArrowAt = -1;
      this.noArrowAt = [];
      this.noArrowParamsConversionAt = [];
      this.maybeInArrowParameters = false;
      this.inType = false;
      this.noAnonFunctionType = false;
      this.hasFlowComment = false;
      this.isAmbientContext = false;
      this.inAbstractClass = false;
      this.inDisallowConditionalTypesContext = false;
      this.topicContext = {
        maxNumOfResolvableTopics: 0,
        maxTopicIndex: null
      };
      this.soloAwait = false;
      this.inFSharpPipelineDirectBody = false;
      this.labels = []; // 跟踪标签集合，处理循环语句
      this.comments = [];
      this.commentStack = [];
      this.pos = 0;
      this.type = 137;
      this.value = null;
      this.start = 0;
      this.end = 0;
      this.lastTokEndLoc = null;
      this.lastTokStartLoc = null;
      this.lastTokStart = 0;
      this.context = [types.brace];
      this.canStartJSXElement = true;
      this.containsEsc = false;
      this.firstInvalidTemplateEscapePos = null;
      this.strictErrors = new Map();
      this.tokensLength = 0;
    }
    // 重新初始化options
    init({
      strictMode,
      sourceType,
      startLine,
      startColumn
    }) {
      this.strict = strictMode === false ? false : strictMode === true ? true : sourceType === "module";
      this.curLine = startLine;
      this.lineStart = -startColumn;
      this.startLoc = this.endLoc = new Position(startLine, startColumn, 0);
    }
    curPosition() {
      return new Position(this.curLine, this.pos - this.lineStart, this.pos);
    }
    clone(skipArrays) {
      const state = new State();
      const keys = Object.keys(this);
      for (let i = 0, length = keys.length; i < length; i++) {
        const key = keys[i];
        let val = this[key];
        if (!skipArrays && Array.isArray(val)) {
          val = val.slice();
        }
        state[key] = val;
      }
      return state;
    }
  }
  class BaseParser {
    constructor() {
      this.sawUnambiguousESM = false;
      this.ambiguousScriptDifferentAst = false;
    }
    hasPlugin(pluginConfig) {
      if (typeof pluginConfig === "string") {
        return this.plugins.has(pluginConfig);
      } else {
        const [pluginName, pluginOptions] = pluginConfig;
        if (!this.hasPlugin(pluginName)) {
          return false;
        }
        const actualOptions = this.plugins.get(pluginName);
        for (const key of Object.keys(pluginOptions)) {
          if ((actualOptions == null ? void 0 : actualOptions[key]) !== pluginOptions[key]) {
            return false;
          }
        }
        return true;
      }
    }
    getPluginOption(plugin, name) {
      var _this$plugins$get;
      return (_this$plugins$get = this.plugins.get(plugin)) == null ? void 0 : _this$plugins$get[name];
    }
  }
  class CommentsParser extends BaseParser {
    addComment(comment) {
      if (this.filename) comment.loc.filename = this.filename;
      this.state.comments.push(comment);
    }
    processComment(node) {
      const {
        commentStack
      } = this.state;
      const commentStackLength = commentStack.length;
      if (commentStackLength === 0) return;
      let i = commentStackLength - 1;
      const lastCommentWS = commentStack[i];
      if (lastCommentWS.start === node.end) {
        lastCommentWS.leadingNode = node;
        i--;
      }
      const {
        start: nodeStart
      } = node;
      for (; i >= 0; i--) {
        const commentWS = commentStack[i];
        const commentEnd = commentWS.end;
        if (commentEnd > nodeStart) {
          commentWS.containingNode = node;
          this.finalizeComment(commentWS);
          commentStack.splice(i, 1);
        } else {
          if (commentEnd === nodeStart) {
            commentWS.trailingNode = node;
          }
          break;
        }
      }
    }
    finalizeComment(commentWS) {
      const {
        comments
      } = commentWS;
      if (commentWS.leadingNode !== null || commentWS.trailingNode !== null) {
        if (commentWS.leadingNode !== null) {
          setTrailingComments(commentWS.leadingNode, comments);
        }
        if (commentWS.trailingNode !== null) {
          setLeadingComments(commentWS.trailingNode, comments);
        }
      } else {
        const {
          containingNode: node,
          start: commentStart
        } = commentWS;
        if (this.input.charCodeAt(commentStart - 1) === 44) {
          switch (node.type) {
            case "ObjectExpression":
            case "ObjectPattern":
            case "RecordExpression":
              adjustInnerComments(node, node.properties, commentWS);
              break;
            case "CallExpression":
            case "OptionalCallExpression":
              adjustInnerComments(node, node.arguments, commentWS);
              break;
            case "FunctionDeclaration":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
            case "ObjectMethod":
            case "ClassMethod":
            case "ClassPrivateMethod":
              adjustInnerComments(node, node.params, commentWS);
              break;
            case "ArrayExpression":
            case "ArrayPattern":
            case "TupleExpression":
              adjustInnerComments(node, node.elements, commentWS);
              break;
            case "ExportNamedDeclaration":
            case "ImportDeclaration":
              adjustInnerComments(node, node.specifiers, commentWS);
              break;
            default:
              {
                setInnerComments(node, comments);
              }
          }
        } else {
          setInnerComments(node, comments);
        }
      }
    }
    finalizeRemainingComments() {
      const {
        commentStack
      } = this.state;
      for (let i = commentStack.length - 1; i >= 0; i--) {
        this.finalizeComment(commentStack[i]);
      }
      this.state.commentStack = [];
    }
    resetPreviousNodeTrailingComments(node) {
      const {
        commentStack
      } = this.state;
      const {
        length
      } = commentStack;
      if (length === 0) return;
      const commentWS = commentStack[length - 1];
      if (commentWS.leadingNode === node) {
        commentWS.leadingNode = null;
      }
    }
    resetPreviousIdentifierLeadingComments(node) {
      const {
        commentStack
      } = this.state;
      const {
        length
      } = commentStack;
      if (length === 0) return;
      if (commentStack[length - 1].trailingNode === node) {
        commentStack[length - 1].trailingNode = null;
      } else if (length >= 2 && commentStack[length - 2].trailingNode === node) {
        commentStack[length - 2].trailingNode = null;
      }
    }
    takeSurroundingComments(node, start, end) {
      const {
        commentStack
      } = this.state;
      const commentStackLength = commentStack.length;
      if (commentStackLength === 0) return;
      let i = commentStackLength - 1;
      for (; i >= 0; i--) {
        const commentWS = commentStack[i];
        const commentEnd = commentWS.end;
        const commentStart = commentWS.start;
        if (commentStart === end) {
          commentWS.leadingNode = node;
        } else if (commentEnd === start) {
          commentWS.trailingNode = node;
        } else if (commentEnd < start) {
          break;
        }
      }
    }
  }
  // mark4 是否是空白符
  function isWhitespace(code) {
    switch (code) {
      case 0x0009:
      case 0x000b:
      case 0x000c:
      case 32:
      case 160:
      case 5760:
      case 0x2000:
      case 0x2001:
      case 0x2002:
      case 0x2003:
      case 0x2004:
      case 0x2005:
      case 0x2006:
      case 0x2007:
      case 0x2008:
      case 0x2009:
      case 0x200a:
      case 0x202f:
      case 0x205f:
      case 0x3000:
      case 0xfeff:
        return true;
      default:
        return false;
    }
  }
  class Tokenizer extends CommentsParser {
    constructor(options, input) {

      /**
       * 最基础的解析类  
       * this.sawUnambiguousESM = false;
       * this.ambiguousScriptDifferentAst = false;
       */
      
      super(); // 获取BaseParser的配置
      this.isLookahead = void 0;
      this.tokens = [];
      /**
       * 错误出来
       */
      // this.errorHandlers_readInt = {
      //   invalidDigit: (pos, lineStart, curLine, radix) => {
      //     if (!this.options.errorRecovery) return false;
      //     this.raise(Errors.InvalidDigit, {
      //       at: buildPosition(pos, lineStart, curLine),
      //       radix
      //     });
      //     return true;
      //   },
      //   // numericSeparatorInEscapeSequence: this.errorBuilder(Errors.NumericSeparatorInEscapeSequence),
      //   // unexpectedNumericSeparator: this.errorBuilder(Errors.UnexpectedNumericSeparator)
      // };
      // this.errorHandlers_readCodePoint = Object.assign({}, this.errorHandlers_readInt, {
      //   invalidEscapeSequence: this.errorBuilder(Errors.InvalidEscapeSequence),
      //   invalidCodePoint: this.errorBuilder(Errors.InvalidCodePoint)
      // });
      // this.errorHandlers_readStringContents_string = Object.assign({}, this.errorHandlers_readCodePoint, {
      //   strictNumericEscape: (pos, lineStart, curLine) => {
      //     this.recordStrictModeErrors(Errors.StrictNumericEscape, {
      //       at: buildPosition(pos, lineStart, curLine)
      //     });
      //   },
      //   unterminated: (pos, lineStart, curLine) => {
      //     throw this.raise(Errors.UnterminatedString, {
      //       at: buildPosition(pos - 1, lineStart, curLine)
      //     });
      //   }
      // });
      // this.errorHandlers_readStringContents_template = Object.assign({}, this.errorHandlers_readCodePoint, {
      //   strictNumericEscape: this.errorBuilder(Errors.StrictNumericEscape),
      //   unterminated: (pos, lineStart, curLine) => {
      //     throw this.raise(Errors.UnterminatedTemplate, {
      //       at: buildPosition(pos, lineStart, curLine)
      //     });
      //   }
      // });
      this.state = new State();
      // 修改options
      this.state.init(options);
      // input输入
      // console.log(this.state)
      this.input = input;
      this.length = input.length;
      this.isLookahead = false;
    }
    pushToken(token) {
      this.tokens.length = this.state.tokensLength;
      this.tokens.push(token);
      ++this.state.tokensLength;
    }
    next() {
      this.checkKeywordEscapes();
      if (this.options.tokens) {
        this.pushToken(new Token(this.state));
      }
      this.state.lastTokStart = this.state.start;
      this.state.lastTokEndLoc = this.state.endLoc;
      this.state.lastTokStartLoc = this.state.startLoc;
      this.nextToken();
    }
    eat(type) {
      if (this.match(type)) {
        this.next();
        return true;
      } else {
        return false;
      }
    }
    match(type) {
      return this.state.type === type;
    }
    createLookaheadState(state) {
      return {
        pos: state.pos,
        value: null,
        type: state.type,
        start: state.start,
        end: state.end,
        context: [this.curContext()],
        inType: state.inType,
        startLoc: state.startLoc,
        lastTokEndLoc: state.lastTokEndLoc,
        curLine: state.curLine,
        lineStart: state.lineStart,
        curPosition: state.curPosition
      };
    }
    lookahead() {
      const old = this.state;
      this.state = this.createLookaheadState(old);
      this.isLookahead = true;
      this.nextToken();
      this.isLookahead = false;
      const curr = this.state;
      this.state = old;
      return curr;
    }
    nextTokenStart() {
      return this.nextTokenStartSince(this.state.pos);
    }
    nextTokenStartSince(pos) {
      skipWhiteSpace.lastIndex = pos;
      return skipWhiteSpace.test(this.input) ? skipWhiteSpace.lastIndex : pos;
    }
    lookaheadCharCode() {
      return this.input.charCodeAt(this.nextTokenStart());
    }
    nextTokenInLineStart() {
      return this.nextTokenInLineStartSince(this.state.pos);
    }
    nextTokenInLineStartSince(pos) {
      skipWhiteSpaceInLine.lastIndex = pos;
      return skipWhiteSpaceInLine.test(this.input) ? skipWhiteSpaceInLine.lastIndex : pos;
    }
    lookaheadInLineCharCode() {
      return this.input.charCodeAt(this.nextTokenInLineStart());
    }
    codePointAtPos(pos) {
      let cp = this.input.charCodeAt(pos);
      if ((cp & 0xfc00) === 0xd800 && ++pos < this.input.length) {
        const trail = this.input.charCodeAt(pos);
        if ((trail & 0xfc00) === 0xdc00) {
          cp = 0x10000 + ((cp & 0x3ff) << 10) + (trail & 0x3ff);
        }
      }
      return cp;
    }
    setStrict(strict) {
      this.state.strict = strict;
      if (strict) {
        this.state.strictErrors.forEach(([toParseError, at]) => this.raise(toParseError, {
          at
        }));
        this.state.strictErrors.clear();
      }
    }
    curContext() {
      return this.state.context[this.state.context.length - 1];
    }
    nextToken() {
      // mark4
      this.skipSpace();
      this.state.start = this.state.pos;
      if (!this.isLookahead) this.state.startLoc = this.state.curPosition();
      if (this.state.pos >= this.length) {
        this.finishToken(137);
        return;
      }
      this.getTokenFromCode(this.codePointAtPos(this.state.pos));
    }
    skipBlockComment(commentEnd) {
      let startLoc;
      if (!this.isLookahead) startLoc = this.state.curPosition();
      const start = this.state.pos;
      const end = this.input.indexOf(commentEnd, start + 2);
      if (end === -1) {
        throw this.raise(Errors.UnterminatedComment, {
          at: this.state.curPosition()
        });
      }
      this.state.pos = end + commentEnd.length;
      lineBreakG.lastIndex = start + 2;
      while (lineBreakG.test(this.input) && lineBreakG.lastIndex <= end) {
        ++this.state.curLine;
        this.state.lineStart = lineBreakG.lastIndex;
      }
      if (this.isLookahead) return;
      const comment = {
        type: "CommentBlock",
        value: this.input.slice(start + 2, end),
        start,
        end: end + commentEnd.length,
        loc: new SourceLocation(startLoc, this.state.curPosition())
      };
      if (this.options.tokens) this.pushToken(comment);
      return comment;
    }
    skipLineComment(startSkip) {
      const start = this.state.pos;
      let startLoc;
      if (!this.isLookahead) startLoc = this.state.curPosition();
      let ch = this.input.charCodeAt(this.state.pos += startSkip);
      if (this.state.pos < this.length) {
        while (!isNewLine(ch) && ++this.state.pos < this.length) {
          ch = this.input.charCodeAt(this.state.pos);
        }
      }
      if (this.isLookahead) return;
      const end = this.state.pos;
      const value = this.input.slice(start + startSkip, end);
      const comment = {
        type: "CommentLine",
        value,
        start,
        end,
        loc: new SourceLocation(startLoc, this.state.curPosition())
      };
      if (this.options.tokens) this.pushToken(comment);
      return comment;
    }
    
    // 跳过空格
    skipSpace() {
      const spaceStart = this.state.pos;
      const comments = [];
      // charCodeAt 0-65535整数
      loop: while (this.state.pos < this.length) {
        const ch = this.input.charCodeAt(this.state.pos);
        switch (ch) {
          /**
           * 160 " "
           * 32 ""
           * 9 水平制表符号 \t
           * 直接跳过
           */
          case 32:
          case 160:
          case 9:
            ++this.state.pos;
            break;
          case 13:
            // 回车符和换行符（Carriage Return + Line Feed）
            if (this.input.charCodeAt(this.state.pos + 1) === 10) {
              ++this.state.pos;
            }
          /**
           * 10 换行符（Line Feed）
           * 8232 行分隔符（Line Separator）
           * 8233 段落分隔符（Paragraph Separator）
           */
          case 10:
          case 8232:
          case 8233:
            ++this.state.pos;
            ++this.state.curLine; // 加一行
            this.state.lineStart = this.state.pos;
            break;
            /**
             * 47，它对应的字符是正斜杠（Slash），一般用于表示路径或者分隔符
             * 42，它对应的字符是星号（Asterisk），常用于表示通配符或者乘法运算中的乘号
             */
          case 47:
            switch (this.input.charCodeAt(this.state.pos + 1)) {
              case 42:
                {
                  const comment = this.skipBlockComment("*/");
                  if (comment !== undefined) {
                    this.addComment(comment);
                    if (this.options.attachComment) comments.push(comment);
                  }
                  break;
                }
              case 47:
                {
                  const comment = this.skipLineComment(2);
                  if (comment !== undefined) {
                    this.addComment(comment);
                    if (this.options.attachComment) comments.push(comment);
                  }
                  break;
                }
              default:
                break loop;
            }
            break;
          default:
            // 正常代码
            if (isWhitespace(ch)) {
              ++this.state.pos;
            } else if (ch === 45 && !this.inModule && this.options.annexB) {
              const pos = this.state.pos;
              if (this.input.charCodeAt(pos + 1) === 45 && this.input.charCodeAt(pos + 2) === 62 && (spaceStart === 0 || this.state.lineStart > spaceStart)) {
                const comment = this.skipLineComment(3);
                if (comment !== undefined) {
                  this.addComment(comment);
                  if (this.options.attachComment) comments.push(comment);
                }
              } else {
                break loop;
              }
            } else if (ch === 60 && !this.inModule && this.options.annexB) {
              const pos = this.state.pos;
              if (this.input.charCodeAt(pos + 1) === 33 && this.input.charCodeAt(pos + 2) === 45 && this.input.charCodeAt(pos + 3) === 45) {
                const comment = this.skipLineComment(4);
                if (comment !== undefined) {
                  this.addComment(comment);
                  if (this.options.attachComment) comments.push(comment);
                }
              } else {
                break loop;
              }
            } else {
              break loop;
            }
        }
      }
      if (comments.length > 0) {
        const end = this.state.pos;
        const commentWhitespace = {
          start: spaceStart,
          end,
          comments,
          leadingNode: null,
          trailingNode: null,
          containingNode: null
        };
        this.state.commentStack.push(commentWhitespace);
      }
    }
    finishToken(type, val) {
      this.state.end = this.state.pos;
      this.state.endLoc = this.state.curPosition();
      const prevType = this.state.type;
      this.state.type = type;
      this.state.value = val;
      if (!this.isLookahead) {
        this.updateContext(prevType);
      }
    }
    replaceToken(type) {
      this.state.type = type;
      this.updateContext();
    }
    readToken_numberSign() {
      if (this.state.pos === 0 && this.readToken_interpreter()) {
        return;
      }
      const nextPos = this.state.pos + 1;
      const next = this.codePointAtPos(nextPos);
      if (next >= 48 && next <= 57) {
        throw this.raise(Errors.UnexpectedDigitAfterHash, {
          at: this.state.curPosition()
        });
      }
      if (next === 123 || next === 91 && this.hasPlugin("recordAndTuple")) {
        this.expectPlugin("recordAndTuple");
        if (this.getPluginOption("recordAndTuple", "syntaxType") === "bar") {
          throw this.raise(next === 123 ? Errors.RecordExpressionHashIncorrectStartSyntaxType : Errors.TupleExpressionHashIncorrectStartSyntaxType, {
            at: this.state.curPosition()
          });
        }
        this.state.pos += 2;
        if (next === 123) {
          this.finishToken(7);
        } else {
          this.finishToken(1);
        }
      } else if (isIdentifierStart(next)) {
        ++this.state.pos;
        this.finishToken(136, this.readWord1(next));
      } else if (next === 92) {
        ++this.state.pos;
        this.finishToken(136, this.readWord1());
      } else {
        this.finishOp(27, 1);
      }
    }
    readToken_dot() {
      const next = this.input.charCodeAt(this.state.pos + 1);
      if (next >= 48 && next <= 57) {
        this.readNumber(true);
        return;
      }
      if (next === 46 && this.input.charCodeAt(this.state.pos + 2) === 46) {
        this.state.pos += 3;
        this.finishToken(21);
      } else {
        ++this.state.pos;
        this.finishToken(16);
      }
    }
    readToken_slash() {
      const next = this.input.charCodeAt(this.state.pos + 1);
      if (next === 61) {
        this.finishOp(31, 2);
      } else {
        this.finishOp(56, 1);
      }
    }
    readToken_interpreter() {
      if (this.state.pos !== 0 || this.length < 2) return false;
      let ch = this.input.charCodeAt(this.state.pos + 1);
      if (ch !== 33) return false;
      const start = this.state.pos;
      this.state.pos += 1;
      while (!isNewLine(ch) && ++this.state.pos < this.length) {
        ch = this.input.charCodeAt(this.state.pos);
      }
      const value = this.input.slice(start + 2, this.state.pos);
      this.finishToken(28, value);
      return true;
    }
    readToken_mult_modulo(code) {
      let type = code === 42 ? 55 : 54;
      let width = 1;
      let next = this.input.charCodeAt(this.state.pos + 1);
      if (code === 42 && next === 42) {
        width++;
        next = this.input.charCodeAt(this.state.pos + 2);
        type = 57;
      }
      if (next === 61 && !this.state.inType) {
        width++;
        type = code === 37 ? 33 : 30;
      }
      this.finishOp(type, width);
    }
    readToken_pipe_amp(code) {
      const next = this.input.charCodeAt(this.state.pos + 1);
      if (next === code) {
        if (this.input.charCodeAt(this.state.pos + 2) === 61) {
          this.finishOp(30, 3);
        } else {
          this.finishOp(code === 124 ? 41 : 42, 2);
        }
        return;
      }
      if (code === 124) {
        if (next === 62) {
          this.finishOp(39, 2);
          return;
        }
        if (this.hasPlugin("recordAndTuple") && next === 125) {
          if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
            throw this.raise(Errors.RecordExpressionBarIncorrectEndSyntaxType, {
              at: this.state.curPosition()
            });
          }
          this.state.pos += 2;
          this.finishToken(9);
          return;
        }
        if (this.hasPlugin("recordAndTuple") && next === 93) {
          if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
            throw this.raise(Errors.TupleExpressionBarIncorrectEndSyntaxType, {
              at: this.state.curPosition()
            });
          }
          this.state.pos += 2;
          this.finishToken(4);
          return;
        }
      }
      if (next === 61) {
        this.finishOp(30, 2);
        return;
      }
      this.finishOp(code === 124 ? 43 : 45, 1);
    }
    readToken_caret() {
      const next = this.input.charCodeAt(this.state.pos + 1);
      if (next === 61 && !this.state.inType) {
        this.finishOp(32, 2);
      } else if (next === 94 && this.hasPlugin(["pipelineOperator", {
        proposal: "hack",
        topicToken: "^^"
      }])) {
        this.finishOp(37, 2);
        const lookaheadCh = this.input.codePointAt(this.state.pos);
        if (lookaheadCh === 94) {
          this.unexpected();
        }
      } else {
        this.finishOp(44, 1);
      }
    }
    readToken_atSign() {
      const next = this.input.charCodeAt(this.state.pos + 1);
      if (next === 64 && this.hasPlugin(["pipelineOperator", {
        proposal: "hack",
        topicToken: "@@"
      }])) {
        this.finishOp(38, 2);
      } else {
        this.finishOp(26, 1);
      }
    }
    readToken_plus_min(code) {
      const next = this.input.charCodeAt(this.state.pos + 1);
      if (next === code) {
        this.finishOp(34, 2);
        return;
      }
      if (next === 61) {
        this.finishOp(30, 2);
      } else {
        this.finishOp(53, 1);
      }
    }
    readToken_lt() {
      const {
        pos
      } = this.state;
      const next = this.input.charCodeAt(pos + 1);
      if (next === 60) {
        if (this.input.charCodeAt(pos + 2) === 61) {
          this.finishOp(30, 3);
          return;
        }
        this.finishOp(51, 2);
        return;
      }
      if (next === 61) {
        this.finishOp(49, 2);
        return;
      }
      this.finishOp(47, 1);
    }
    readToken_gt() {
      const {
        pos
      } = this.state;
      const next = this.input.charCodeAt(pos + 1);
      if (next === 62) {
        const size = this.input.charCodeAt(pos + 2) === 62 ? 3 : 2;
        if (this.input.charCodeAt(pos + size) === 61) {
          this.finishOp(30, size + 1);
          return;
        }
        this.finishOp(52, size);
        return;
      }
      if (next === 61) {
        this.finishOp(49, 2);
        return;
      }
      this.finishOp(48, 1);
    }
    readToken_eq_excl(code) {
      const next = this.input.charCodeAt(this.state.pos + 1);
      if (next === 61) {
        this.finishOp(46, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);
        return;
      }
      if (code === 61 && next === 62) {
        this.state.pos += 2;
        this.finishToken(19);
        return;
      }
      this.finishOp(code === 61 ? 29 : 35, 1);
    }
    readToken_question() {
      const next = this.input.charCodeAt(this.state.pos + 1);
      const next2 = this.input.charCodeAt(this.state.pos + 2);
      if (next === 63) {
        if (next2 === 61) {
          this.finishOp(30, 3);
        } else {
          this.finishOp(40, 2);
        }
      } else if (next === 46 && !(next2 >= 48 && next2 <= 57)) {
        this.state.pos += 2;
        this.finishToken(18);
      } else {
        ++this.state.pos;
        this.finishToken(17);
      }
    }
    getTokenFromCode(code) {
      switch (code) {
        case 46:
          this.readToken_dot();
          return;
        case 40:
          ++this.state.pos;
          this.finishToken(10);
          return;
        case 41:
          ++this.state.pos;
          this.finishToken(11);
          return;
        case 59:
          ++this.state.pos;
          this.finishToken(13);
          return;
        case 44:
          ++this.state.pos;
          this.finishToken(12);
          return;
        case 91:
          if (this.hasPlugin("recordAndTuple") && this.input.charCodeAt(this.state.pos + 1) === 124) {
            if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
              throw this.raise(Errors.TupleExpressionBarIncorrectStartSyntaxType, {
                at: this.state.curPosition()
              });
            }
            this.state.pos += 2;
            this.finishToken(2);
          } else {
            ++this.state.pos;
            this.finishToken(0);
          }
          return;
        case 93:
          ++this.state.pos;
          this.finishToken(3);
          return;
        case 123:
          if (this.hasPlugin("recordAndTuple") && this.input.charCodeAt(this.state.pos + 1) === 124) {
            if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
              throw this.raise(Errors.RecordExpressionBarIncorrectStartSyntaxType, {
                at: this.state.curPosition()
              });
            }
            this.state.pos += 2;
            this.finishToken(6);
          } else {
            ++this.state.pos;
            this.finishToken(5);
          }
          return;
        case 125:
          ++this.state.pos;
          this.finishToken(8);
          return;
        case 58:
          if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
            this.finishOp(15, 2);
          } else {
            ++this.state.pos;
            this.finishToken(14);
          }
          return;
        case 63:
          this.readToken_question();
          return;
        case 96:
          this.readTemplateToken();
          return;
        case 48:
          {
            const next = this.input.charCodeAt(this.state.pos + 1);
            if (next === 120 || next === 88) {
              this.readRadixNumber(16);
              return;
            }
            if (next === 111 || next === 79) {
              this.readRadixNumber(8);
              return;
            }
            if (next === 98 || next === 66) {
              this.readRadixNumber(2);
              return;
            }
          }
        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
          this.readNumber(false);
          return;
        case 34:
        case 39:
          this.readString(code);
          return;
        case 47:
          this.readToken_slash();
          return;
        case 37:
        case 42:
          this.readToken_mult_modulo(code);
          return;
        case 124:
        case 38:
          this.readToken_pipe_amp(code);
          return;
        case 94:
          this.readToken_caret();
          return;
        case 43:
        case 45:
          this.readToken_plus_min(code);
          return;
        case 60:
          this.readToken_lt();
          return;
        case 62:
          this.readToken_gt();
          return;
        case 61:
        case 33:
          this.readToken_eq_excl(code);
          return;
        case 126:
          this.finishOp(36, 1);
          return;
        case 64:
          this.readToken_atSign();
          return;
        case 35:
          this.readToken_numberSign();
          return;
        case 92:
          this.readWord();
          return;
        default:
          if (isIdentifierStart(code)) {
            this.readWord(code);
            return;
          }
      }
      throw this.raise(Errors.InvalidOrUnexpectedToken, {
        at: this.state.curPosition(),
        unexpected: String.fromCodePoint(code)
      });
    }
    finishOp(type, size) {
      const str = this.input.slice(this.state.pos, this.state.pos + size);
      this.state.pos += size;
      this.finishToken(type, str);
    }
    readRegexp() {
      const startLoc = this.state.startLoc;
      const start = this.state.start + 1;
      let escaped, inClass;
      let {
        pos
      } = this.state;
      for (;; ++pos) {
        if (pos >= this.length) {
          throw this.raise(Errors.UnterminatedRegExp, {
            at: createPositionWithColumnOffset(startLoc, 1)
          });
        }
        const ch = this.input.charCodeAt(pos);
        if (isNewLine(ch)) {
          throw this.raise(Errors.UnterminatedRegExp, {
            at: createPositionWithColumnOffset(startLoc, 1)
          });
        }
        if (escaped) {
          escaped = false;
        } else {
          if (ch === 91) {
            inClass = true;
          } else if (ch === 93 && inClass) {
            inClass = false;
          } else if (ch === 47 && !inClass) {
            break;
          }
          escaped = ch === 92;
        }
      }
      const content = this.input.slice(start, pos);
      ++pos;
      let mods = "";
      const nextPos = () => createPositionWithColumnOffset(startLoc, pos + 2 - start);
      while (pos < this.length) {
        const cp = this.codePointAtPos(pos);
        const char = String.fromCharCode(cp);
        if (VALID_REGEX_FLAGS.has(cp)) {
          if (cp === 118) {
            if (mods.includes("u")) {
              this.raise(Errors.IncompatibleRegExpUVFlags, {
                at: nextPos()
              });
            }
          } else if (cp === 117) {
            if (mods.includes("v")) {
              this.raise(Errors.IncompatibleRegExpUVFlags, {
                at: nextPos()
              });
            }
          }
          if (mods.includes(char)) {
            this.raise(Errors.DuplicateRegExpFlags, {
              at: nextPos()
            });
          }
        } else if (isIdentifierChar(cp) || cp === 92) {
          this.raise(Errors.MalformedRegExpFlags, {
            at: nextPos()
          });
        } else {
          break;
        }
        ++pos;
        mods += char;
      }
      this.state.pos = pos;
      this.finishToken(135, {
        pattern: content,
        flags: mods
      });
    }
    readInt(radix, len, forceLen = false, allowNumSeparator = true) {
      const {
        n,
        pos
      } = readInt(this.input, this.state.pos, this.state.lineStart, this.state.curLine, radix, len, forceLen, allowNumSeparator, this.errorHandlers_readInt, false);
      this.state.pos = pos;
      return n;
    }
    readRadixNumber(radix) {
      const startLoc = this.state.curPosition();
      let isBigInt = false;
      this.state.pos += 2;
      const val = this.readInt(radix);
      if (val == null) {
        this.raise(Errors.InvalidDigit, {
          at: createPositionWithColumnOffset(startLoc, 2),
          radix
        });
      }
      const next = this.input.charCodeAt(this.state.pos);
      if (next === 110) {
        ++this.state.pos;
        isBigInt = true;
      } else if (next === 109) {
        throw this.raise(Errors.InvalidDecimal, {
          at: startLoc
        });
      }
      if (isIdentifierStart(this.codePointAtPos(this.state.pos))) {
        throw this.raise(Errors.NumberIdentifier, {
          at: this.state.curPosition()
        });
      }
      if (isBigInt) {
        const str = this.input.slice(startLoc.index, this.state.pos).replace(/[_n]/g, "");
        this.finishToken(133, str);
        return;
      }
      this.finishToken(132, val);
    }
    readNumber(startsWithDot) {
      const start = this.state.pos;
      const startLoc = this.state.curPosition();
      let isFloat = false;
      let isBigInt = false;
      let isDecimal = false;
      let hasExponent = false;
      let isOctal = false;
      if (!startsWithDot && this.readInt(10) === null) {
        this.raise(Errors.InvalidNumber, {
          at: this.state.curPosition()
        });
      }
      const hasLeadingZero = this.state.pos - start >= 2 && this.input.charCodeAt(start) === 48;
      if (hasLeadingZero) {
        const integer = this.input.slice(start, this.state.pos);
        this.recordStrictModeErrors(Errors.StrictOctalLiteral, {
          at: startLoc
        });
        if (!this.state.strict) {
          const underscorePos = integer.indexOf("_");
          if (underscorePos > 0) {
            this.raise(Errors.ZeroDigitNumericSeparator, {
              at: createPositionWithColumnOffset(startLoc, underscorePos)
            });
          }
        }
        isOctal = hasLeadingZero && !/[89]/.test(integer);
      }
      let next = this.input.charCodeAt(this.state.pos);
      if (next === 46 && !isOctal) {
        ++this.state.pos;
        this.readInt(10);
        isFloat = true;
        next = this.input.charCodeAt(this.state.pos);
      }
      if ((next === 69 || next === 101) && !isOctal) {
        next = this.input.charCodeAt(++this.state.pos);
        if (next === 43 || next === 45) {
          ++this.state.pos;
        }
        if (this.readInt(10) === null) {
          this.raise(Errors.InvalidOrMissingExponent, {
            at: startLoc
          });
        }
        isFloat = true;
        hasExponent = true;
        next = this.input.charCodeAt(this.state.pos);
      }
      if (next === 110) {
        if (isFloat || hasLeadingZero) {
          this.raise(Errors.InvalidBigIntLiteral, {
            at: startLoc
          });
        }
        ++this.state.pos;
        isBigInt = true;
      }
      if (next === 109) {
        this.expectPlugin("decimal", this.state.curPosition());
        if (hasExponent || hasLeadingZero) {
          this.raise(Errors.InvalidDecimal, {
            at: startLoc
          });
        }
        ++this.state.pos;
        isDecimal = true;
      }
      if (isIdentifierStart(this.codePointAtPos(this.state.pos))) {
        throw this.raise(Errors.NumberIdentifier, {
          at: this.state.curPosition()
        });
      }
      const str = this.input.slice(start, this.state.pos).replace(/[_mn]/g, "");
      if (isBigInt) {
        this.finishToken(133, str);
        return;
      }
      if (isDecimal) {
        this.finishToken(134, str);
        return;
      }
      const val = isOctal ? parseInt(str, 8) : parseFloat(str);
      this.finishToken(132, val);
    }
    readCodePoint(throwOnInvalid) {
      const {
        code,
        pos
      } = readCodePoint(this.input, this.state.pos, this.state.lineStart, this.state.curLine, throwOnInvalid, this.errorHandlers_readCodePoint);
      this.state.pos = pos;
      return code;
    }
    readString(quote) {
      const {
        str,
        pos,
        curLine,
        lineStart
      } = readStringContents(quote === 34 ? "double" : "single", this.input, this.state.pos + 1, this.state.lineStart, this.state.curLine, this.errorHandlers_readStringContents_string);
      this.state.pos = pos + 1;
      this.state.lineStart = lineStart;
      this.state.curLine = curLine;
      this.finishToken(131, str);
    }
    readTemplateContinuation() {
      if (!this.match(8)) {
        this.unexpected(null, 8);
      }
      this.state.pos--;
      this.readTemplateToken();
    }
    readTemplateToken() {
      const opening = this.input[this.state.pos];
      const {
        str,
        firstInvalidLoc,
        pos,
        curLine,
        lineStart
      } = readStringContents("template", this.input, this.state.pos + 1, this.state.lineStart, this.state.curLine, this.errorHandlers_readStringContents_template);
      this.state.pos = pos + 1;
      this.state.lineStart = lineStart;
      this.state.curLine = curLine;
      if (firstInvalidLoc) {
        this.state.firstInvalidTemplateEscapePos = new Position(firstInvalidLoc.curLine, firstInvalidLoc.pos - firstInvalidLoc.lineStart, firstInvalidLoc.pos);
      }
      if (this.input.codePointAt(pos) === 96) {
        this.finishToken(24, firstInvalidLoc ? null : opening + str + "`");
      } else {
        this.state.pos++;
        this.finishToken(25, firstInvalidLoc ? null : opening + str + "${");
      }
    }
    recordStrictModeErrors(toParseError, {
      at
    }) {
      const index = at.index;
      if (this.state.strict && !this.state.strictErrors.has(index)) {
        this.raise(toParseError, {
          at
        });
      } else {
        this.state.strictErrors.set(index, [toParseError, at]);
      }
    }
    readWord1(firstCode) {
      this.state.containsEsc = false;
      let word = "";
      const start = this.state.pos;
      let chunkStart = this.state.pos;
      if (firstCode !== undefined) {
        this.state.pos += firstCode <= 0xffff ? 1 : 2;
      }
      while (this.state.pos < this.length) {
        const ch = this.codePointAtPos(this.state.pos);
        if (isIdentifierChar(ch)) {
          this.state.pos += ch <= 0xffff ? 1 : 2;
        } else if (ch === 92) {
          this.state.containsEsc = true;
          word += this.input.slice(chunkStart, this.state.pos);
          const escStart = this.state.curPosition();
          const identifierCheck = this.state.pos === start ? isIdentifierStart : isIdentifierChar;
          if (this.input.charCodeAt(++this.state.pos) !== 117) {
            this.raise(Errors.MissingUnicodeEscape, {
              at: this.state.curPosition()
            });
            chunkStart = this.state.pos - 1;
            continue;
          }
          ++this.state.pos;
          const esc = this.readCodePoint(true);
          if (esc !== null) {
            if (!identifierCheck(esc)) {
              this.raise(Errors.EscapedCharNotAnIdentifier, {
                at: escStart
              });
            }
            word += String.fromCodePoint(esc);
          }
          chunkStart = this.state.pos;
        } else {
          break;
        }
      }
      return word + this.input.slice(chunkStart, this.state.pos);
    }
    readWord(firstCode) {
      const word = this.readWord1(firstCode);
      const type = keywords$1.get(word);
      if (type !== undefined) {
        this.finishToken(type, tokenLabelName(type));
      } else {
        this.finishToken(130, word);
      }
    }
    checkKeywordEscapes() {
      const {
        type
      } = this.state;
      if (tokenIsKeyword(type) && this.state.containsEsc) {
        this.raise(Errors.InvalidEscapedReservedWord, {
          at: this.state.startLoc,
          reservedWord: tokenLabelName(type)
        });
      }
    }
    raise(toParseError, raiseProperties) {
      const {
          at
        } = raiseProperties,
        details = _objectWithoutPropertiesLoose(raiseProperties, _excluded);
      const loc = at instanceof Position ? at : at.loc.start;
      const error = toParseError({
        loc,
        details
      });
      if (!this.options.errorRecovery) throw error;
      if (!this.isLookahead) this.state.errors.push(error);
      return error;
    }
    raiseOverwrite(toParseError, raiseProperties) {
      const {
          at
        } = raiseProperties,
        details = _objectWithoutPropertiesLoose(raiseProperties, _excluded2);
      const loc = at instanceof Position ? at : at.loc.start;
      const pos = loc.index;
      const errors = this.state.errors;
      for (let i = errors.length - 1; i >= 0; i--) {
        const error = errors[i];
        if (error.loc.index === pos) {
          return errors[i] = toParseError({
            loc,
            details
          });
        }
        if (error.loc.index < pos) break;
      }
      return this.raise(toParseError, raiseProperties);
    }
    updateContext(prevType) {}
    unexpected(loc, type) {
      throw this.raise(Errors.UnexpectedToken, {
        expected: type ? tokenLabelName(type) : null,
        at: loc != null ? loc : this.state.startLoc
      });
    }
    expectPlugin(pluginName, loc) {
      if (this.hasPlugin(pluginName)) {
        return true;
      }
      throw this.raise(Errors.MissingPlugin, {
        at: loc != null ? loc : this.state.startLoc,
        missingPlugin: [pluginName]
      });
    }
    expectOnePlugin(pluginNames) {
      if (!pluginNames.some(name => this.hasPlugin(name))) {
        throw this.raise(Errors.MissingOneOfPlugins, {
          at: this.state.startLoc,
          missingPlugin: pluginNames
        });
      }
    }
    errorBuilder(error) {
      return (pos, lineStart, curLine) => {
        this.raise(error, {
          at: buildPosition(pos, lineStart, curLine)
        });
      };
    }
  }
  class UtilParser extends Tokenizer {
    addExtra(node, key, value, enumerable = true) {
      if (!node) return;
      const extra = node.extra = node.extra || {};
      if (enumerable) {
        extra[key] = value;
      } else {
        Object.defineProperty(extra, key, {
          enumerable,
          value
        });
      }
    }
    isContextual(token) {
      return this.state.type === token && !this.state.containsEsc;
    }
    isUnparsedContextual(nameStart, name) {
      const nameEnd = nameStart + name.length;
      if (this.input.slice(nameStart, nameEnd) === name) {
        const nextCh = this.input.charCodeAt(nameEnd);
        return !(isIdentifierChar(nextCh) || (nextCh & 0xfc00) === 0xd800);
      }
      return false;
    }
    isLookaheadContextual(name) {
      const next = this.nextTokenStart();
      return this.isUnparsedContextual(next, name);
    }
    eatContextual(token) {
      if (this.isContextual(token)) {
        this.next();
        return true;
      }
      return false;
    }
    expectContextual(token, toParseError) {
      if (!this.eatContextual(token)) {
        if (toParseError != null) {
          throw this.raise(toParseError, {
            at: this.state.startLoc
          });
        }
        this.unexpected(null, token);
      }
    }
    canInsertSemicolon() {
      return this.match(137) || this.match(8) || this.hasPrecedingLineBreak();
    }
    hasPrecedingLineBreak() {
      return lineBreak.test(this.input.slice(this.state.lastTokEndLoc.index, this.state.start));
    }
    hasFollowingLineBreak() {
      skipWhiteSpaceToLineBreak.lastIndex = this.state.end;
      return skipWhiteSpaceToLineBreak.test(this.input);
    }
    isLineTerminator() {
      return this.eat(13) || this.canInsertSemicolon();
    }
    semicolon(allowAsi = true) {
      if (allowAsi ? this.isLineTerminator() : this.eat(13)) return;
      this.raise(Errors.MissingSemicolon, {
        at: this.state.lastTokEndLoc
      });
    }
    expect(type, loc) {
      this.eat(type) || this.unexpected(loc, type);
    }
    tryParse(fn, oldState = this.state.clone()) {
      const abortSignal = {
        node: null
      };
      try {
        const node = fn((node = null) => {
          abortSignal.node = node;
          throw abortSignal;
        });
        if (this.state.errors.length > oldState.errors.length) {
          const failState = this.state;
          this.state = oldState;
          this.state.tokensLength = failState.tokensLength;
          return {
            node,
            error: failState.errors[oldState.errors.length],
            thrown: false,
            aborted: false,
            failState
          };
        }
        return {
          node,
          error: null,
          thrown: false,
          aborted: false,
          failState: null
        };
      } catch (error) {
        const failState = this.state;
        this.state = oldState;
        if (error instanceof SyntaxError) {
          return {
            node: null,
            error,
            thrown: true,
            aborted: false,
            failState
          };
        }
        if (error === abortSignal) {
          return {
            node: abortSignal.node,
            error: null,
            thrown: false,
            aborted: true,
            failState
          };
        }
        throw error;
      }
    }
    checkExpressionErrors(refExpressionErrors, andThrow) {
      if (!refExpressionErrors) return false;
      const {
        shorthandAssignLoc,
        doubleProtoLoc,
        privateKeyLoc,
        optionalParametersLoc
      } = refExpressionErrors;
      const hasErrors = !!shorthandAssignLoc || !!doubleProtoLoc || !!optionalParametersLoc || !!privateKeyLoc;
      if (!andThrow) {
        return hasErrors;
      }
      if (shorthandAssignLoc != null) {
        this.raise(Errors.InvalidCoverInitializedName, {
          at: shorthandAssignLoc
        });
      }
      if (doubleProtoLoc != null) {
        this.raise(Errors.DuplicateProto, {
          at: doubleProtoLoc
        });
      }
      if (privateKeyLoc != null) {
        this.raise(Errors.UnexpectedPrivateField, {
          at: privateKeyLoc
        });
      }
      if (optionalParametersLoc != null) {
        this.unexpected(optionalParametersLoc);
      }
    }
    isLiteralPropertyName() {
      return tokenIsLiteralPropertyName(this.state.type);
    }
    isPrivateName(node) {
      return node.type === "PrivateName";
    }
    getPrivateNameSV(node) {
      return node.id.name;
    }
    hasPropertyAsPrivateName(node) {
      return (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && this.isPrivateName(node.property);
    }
    isObjectProperty(node) {
      return node.type === "ObjectProperty";
    }
    isObjectMethod(node) {
      return node.type === "ObjectMethod";
    }
    initializeScopes(inModule = this.options.sourceType === "module") {
      const oldLabels = this.state.labels;
      // 循环语句标签
      this.state.labels = [];
      const oldExportedIdentifiers = this.exportedIdentifiers;
      // 定义的导出标识符
      this.exportedIdentifiers = new Set();
      const oldInModule = this.inModule;
      this.inModule = inModule;
      const oldScope = this.scope;
      // ScopeHandler类处理各种scoped
      const ScopeHandler = this.getScopeHandler();
      //  定义scoped处理作用域
      this.scope = new ScopeHandler(this, inModule);
      const oldProdParam = this.prodParam;
      // 处理函数
      this.prodParam = new ProductionParameterHandler();
      const oldClassScope = this.classScope;
      // 处理类的程序体
      this.classScope = new ClassScopeHandler(this);
      const oldExpressionScope = this.expressionScope;
      // 处理表达式
      this.expressionScope = new ExpressionScopeHandler(this);
      return () => {
        this.state.labels = oldLabels;
        this.exportedIdentifiers = oldExportedIdentifiers;
        this.inModule = oldInModule;
        this.scope = oldScope;
        this.prodParam = oldProdParam;
        this.classScope = oldClassScope;
        this.expressionScope = oldExpressionScope;
      };
    }
    enterInitialScopes() {
      let paramFlags = PARAM;
      // is in ES Moduless是否在Esmodules中
   
      if (this.inModule) {
        paramFlags |= PARAM_AWAIT;
      }
      // 进入新的作用域如函数
      // mark1
      console.log(this);
      // scope.scopeStack=[]添加Scope => [Scoped]
      this.scope.enter(1);
      // prodParam.stacks=[]添加paramFlags => [0]
      this.prodParam.enter(paramFlags);
    }
    checkDestructuringPrivate(refExpressionErrors) {
      const {
        privateKeyLoc
      } = refExpressionErrors;
      if (privateKeyLoc !== null) {
        this.expectPlugin("destructuringPrivate", privateKeyLoc);
      }
    }
  }
  class SourceLocation {
    constructor(start, end) {
      this.start = void 0;
      this.end = void 0;
      this.filename = void 0;
      this.identifierName = void 0;
      this.start = start;
      this.end = end;
    }
  }
  class Node {
    constructor(parser, pos, loc) {
      this.type = "";
      this.start = pos;
      this.end = 0;
      this.loc = new SourceLocation(loc);
      if (parser != null && parser.options.ranges) this.range = [pos, 0];
      if (parser != null && parser.filename) this.loc.filename = parser.filename;
    }
  }
  // node工具
  class NodeUtils extends UtilParser {
    startNode() {
      return new Node(this, this.state.start, this.state.startLoc);
    }
    startNodeAt(loc) {
      return new Node(this, loc.index, loc);
    }
    startNodeAtNode(type) {
      return this.startNodeAt(type.loc.start);
    }
    finishNode(node, type) {
      return this.finishNodeAt(node, type, this.state.lastTokEndLoc);
    }
    finishNodeAt(node, type, endLoc) {
      node.type = type;
      node.end = endLoc.index;
      node.loc.end = endLoc;
      if (this.options.ranges) node.range[1] = endLoc.index;
      if (this.options.attachComment) this.processComment(node);
      return node;
    }
    resetStartLocation(node, startLoc) {
      node.start = startLoc.index;
      node.loc.start = startLoc;
      if (this.options.ranges) node.range[0] = startLoc.index;
    }
    resetEndLocation(node, endLoc = this.state.lastTokEndLoc) {
      node.end = endLoc.index;
      node.loc.end = endLoc;
      if (this.options.ranges) node.range[1] = endLoc.index;
    }
    resetStartLocationFromNode(node, locationNode) {
      this.resetStartLocation(node, locationNode.loc.start);
    }
  }
  // 左侧值解析
  class LValParser extends NodeUtils {
    toAssignable(node, isLHS = false) {
      var _node$extra, _node$extra3;
      let parenthesized = undefined;
      if (node.type === "ParenthesizedExpression" || (_node$extra = node.extra) != null && _node$extra.parenthesized) {
        parenthesized = unwrapParenthesizedExpression(node);
        if (isLHS) {
          if (parenthesized.type === "Identifier") {
            this.expressionScope.recordArrowParameterBindingError(Errors.InvalidParenthesizedAssignment, {
              at: node
            });
          } else if (parenthesized.type !== "MemberExpression") {
            this.raise(Errors.InvalidParenthesizedAssignment, {
              at: node
            });
          }
        } else {
          this.raise(Errors.InvalidParenthesizedAssignment, {
            at: node
          });
        }
      }
      switch (node.type) {
        case "Identifier":
        case "ObjectPattern":
        case "ArrayPattern":
        case "AssignmentPattern":
        case "RestElement":
          break;
        case "ObjectExpression":
          node.type = "ObjectPattern";
          for (let i = 0, length = node.properties.length, last = length - 1; i < length; i++) {
            var _node$extra2;
            const prop = node.properties[i];
            const isLast = i === last;
            this.toAssignableObjectExpressionProp(prop, isLast, isLHS);
            if (isLast && prop.type === "RestElement" && (_node$extra2 = node.extra) != null && _node$extra2.trailingCommaLoc) {
              this.raise(Errors.RestTrailingComma, {
                at: node.extra.trailingCommaLoc
              });
            }
          }
          break;
        case "ObjectProperty":
          {
            const {
              key,
              value
            } = node;
            if (this.isPrivateName(key)) {
              this.classScope.usePrivateName(this.getPrivateNameSV(key), key.loc.start);
            }
            this.toAssignable(value, isLHS);
            break;
          }
        case "SpreadElement":
          {
            throw new Error("Internal @babel/parser error (this is a bug, please report it)." + " SpreadElement should be converted by .toAssignable's caller.");
          }
        case "ArrayExpression":
          node.type = "ArrayPattern";
          this.toAssignableList(node.elements, (_node$extra3 = node.extra) == null ? void 0 : _node$extra3.trailingCommaLoc, isLHS);
          break;
        case "AssignmentExpression":
          if (node.operator !== "=") {
            this.raise(Errors.MissingEqInAssignment, {
              at: node.left.loc.end
            });
          }
          node.type = "AssignmentPattern";
          delete node.operator;
          this.toAssignable(node.left, isLHS);
          break;
        case "ParenthesizedExpression":
          this.toAssignable(parenthesized, isLHS);
          break;
      }
    }
    toAssignableObjectExpressionProp(prop, isLast, isLHS) {
      if (prop.type === "ObjectMethod") {
        this.raise(prop.kind === "get" || prop.kind === "set" ? Errors.PatternHasAccessor : Errors.PatternHasMethod, {
          at: prop.key
        });
      } else if (prop.type === "SpreadElement") {
        prop.type = "RestElement";
        const arg = prop.argument;
        this.checkToRestConversion(arg, false);
        this.toAssignable(arg, isLHS);
        if (!isLast) {
          this.raise(Errors.RestTrailingComma, {
            at: prop
          });
        }
      } else {
        this.toAssignable(prop, isLHS);
      }
    }
    toAssignableList(exprList, trailingCommaLoc, isLHS) {
      const end = exprList.length - 1;
      for (let i = 0; i <= end; i++) {
        const elt = exprList[i];
        if (!elt) continue;
        if (elt.type === "SpreadElement") {
          elt.type = "RestElement";
          const arg = elt.argument;
          this.checkToRestConversion(arg, true);
          this.toAssignable(arg, isLHS);
        } else {
          this.toAssignable(elt, isLHS);
        }
        if (elt.type === "RestElement") {
          if (i < end) {
            this.raise(Errors.RestTrailingComma, {
              at: elt
            });
          } else if (trailingCommaLoc) {
            this.raise(Errors.RestTrailingComma, {
              at: trailingCommaLoc
            });
          }
        }
      }
    }
    isAssignable(node, isBinding) {
      switch (node.type) {
        case "Identifier":
        case "ObjectPattern":
        case "ArrayPattern":
        case "AssignmentPattern":
        case "RestElement":
          return true;
        case "ObjectExpression":
          {
            const last = node.properties.length - 1;
            return node.properties.every((prop, i) => {
              return prop.type !== "ObjectMethod" && (i === last || prop.type !== "SpreadElement") && this.isAssignable(prop);
            });
          }
        case "ObjectProperty":
          return this.isAssignable(node.value);
        case "SpreadElement":
          return this.isAssignable(node.argument);
        case "ArrayExpression":
          return node.elements.every(element => element === null || this.isAssignable(element));
        case "AssignmentExpression":
          return node.operator === "=";
        case "ParenthesizedExpression":
          return this.isAssignable(node.expression);
        case "MemberExpression":
        case "OptionalMemberExpression":
          return !isBinding;
        default:
          return false;
      }
    }
    toReferencedList(exprList, isParenthesizedExpr) {
      return exprList;
    }
    toReferencedListDeep(exprList, isParenthesizedExpr) {
      this.toReferencedList(exprList, isParenthesizedExpr);
      for (const expr of exprList) {
        if ((expr == null ? void 0 : expr.type) === "ArrayExpression") {
          this.toReferencedListDeep(expr.elements);
        }
      }
    }
    parseSpread(refExpressionErrors) {
      const node = this.startNode();
      this.next();
      node.argument = this.parseMaybeAssignAllowIn(refExpressionErrors, undefined);
      return this.finishNode(node, "SpreadElement");
    }
    parseRestBinding() {
      const node = this.startNode();
      this.next();
      node.argument = this.parseBindingAtom();
      return this.finishNode(node, "RestElement");
    }
    parseBindingAtom() {
      switch (this.state.type) {
        case 0:
          {
            const node = this.startNode();
            this.next();
            node.elements = this.parseBindingList(3, 93, 1);
            return this.finishNode(node, "ArrayPattern");
          }
        case 5:
          return this.parseObjectLike(8, true);
      }
      return this.parseIdentifier();
    }
    parseBindingList(close, closeCharCode, flags) {
      const allowEmpty = flags & 1;
      const elts = [];
      let first = true;
      while (!this.eat(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(12);
        }
        if (allowEmpty && this.match(12)) {
          elts.push(null);
        } else if (this.eat(close)) {
          break;
        } else if (this.match(21)) {
          elts.push(this.parseAssignableListItemTypes(this.parseRestBinding(), flags));
          if (!this.checkCommaAfterRest(closeCharCode)) {
            this.expect(close);
            break;
          }
        } else {
          const decorators = [];
          if (this.match(26) && this.hasPlugin("decorators")) {
            this.raise(Errors.UnsupportedParameterDecorator, {
              at: this.state.startLoc
            });
          }
          while (this.match(26)) {
            decorators.push(this.parseDecorator());
          }
          elts.push(this.parseAssignableListItem(flags, decorators));
        }
      }
      return elts;
    }
    parseBindingRestProperty(prop) {
      this.next();
      prop.argument = this.parseIdentifier();
      this.checkCommaAfterRest(125);
      return this.finishNode(prop, "RestElement");
    }
    parseBindingProperty() {
      const prop = this.startNode();
      const {
        type,
        startLoc
      } = this.state;
      if (type === 21) {
        return this.parseBindingRestProperty(prop);
      } else if (type === 136) {
        this.expectPlugin("destructuringPrivate", startLoc);
        this.classScope.usePrivateName(this.state.value, startLoc);
        prop.key = this.parsePrivateName();
      } else {
        this.parsePropertyName(prop);
      }
      prop.method = false;
      return this.parseObjPropValue(prop, startLoc, false, false, true, false);
    }
    parseAssignableListItem(flags, decorators) {
      const left = this.parseMaybeDefault();
      this.parseAssignableListItemTypes(left, flags);
      const elt = this.parseMaybeDefault(left.loc.start, left);
      if (decorators.length) {
        left.decorators = decorators;
      }
      return elt;
    }
    parseAssignableListItemTypes(param, flags) {
      return param;
    }
    parseMaybeDefault(startLoc, left) {
      var _startLoc, _left;
      (_startLoc = startLoc) != null ? _startLoc : startLoc = this.state.startLoc;
      left = (_left = left) != null ? _left : this.parseBindingAtom();
      if (!this.eat(29)) return left;
      const node = this.startNodeAt(startLoc);
      node.left = left;
      node.right = this.parseMaybeAssignAllowIn();
      return this.finishNode(node, "AssignmentPattern");
    }
    isValidLVal(type, isUnparenthesizedInAssign, binding) {
      return getOwn$1({
        AssignmentPattern: "left",
        RestElement: "argument",
        ObjectProperty: "value",
        ParenthesizedExpression: "expression",
        ArrayPattern: "elements",
        ObjectPattern: "properties"
      }, type);
    }
    checkLVal(expression, {
      in: ancestor,
      binding = 64,
      checkClashes = false,
      strictModeChanged = false,
      hasParenthesizedAncestor = false
    }) {
      var _expression$extra;
      const type = expression.type;
      if (this.isObjectMethod(expression)) return;
      if (type === "MemberExpression") {
        if (binding !== 64) {
          this.raise(Errors.InvalidPropertyBindingPattern, {
            at: expression
          });
        }
        return;
      }
      if (type === "Identifier") {
        this.checkIdentifier(expression, binding, strictModeChanged);
        const {
          name
        } = expression;
        if (checkClashes) {
          if (checkClashes.has(name)) {
            this.raise(Errors.ParamDupe, {
              at: expression
            });
          } else {
            checkClashes.add(name);
          }
        }
        return;
      }
      const validity = this.isValidLVal(type, !(hasParenthesizedAncestor || (_expression$extra = expression.extra) != null && _expression$extra.parenthesized) && ancestor.type === "AssignmentExpression", binding);
      if (validity === true) return;
      if (validity === false) {
        const ParseErrorClass = binding === 64 ? Errors.InvalidLhs : Errors.InvalidLhsBinding;
        this.raise(ParseErrorClass, {
          at: expression,
          ancestor
        });
        return;
      }
      const [key, isParenthesizedExpression] = Array.isArray(validity) ? validity : [validity, type === "ParenthesizedExpression"];
      const nextAncestor = type === "ArrayPattern" || type === "ObjectPattern" || type === "ParenthesizedExpression" ? {
        type
      } : ancestor;
      for (const child of [].concat(expression[key])) {
        if (child) {
          this.checkLVal(child, {
            in: nextAncestor,
            binding,
            checkClashes,
            strictModeChanged,
            hasParenthesizedAncestor: isParenthesizedExpression
          });
        }
      }
    }
    checkIdentifier(at, bindingType, strictModeChanged = false) {
      if (this.state.strict && (strictModeChanged ? isStrictBindReservedWord(at.name, this.inModule) : isStrictBindOnlyReservedWord(at.name))) {
        if (bindingType === 64) {
          this.raise(Errors.StrictEvalArguments, {
            at,
            referenceName: at.name
          });
        } else {
          this.raise(Errors.StrictEvalArgumentsBinding, {
            at,
            bindingName: at.name
          });
        }
      }
      if (bindingType & 8192 && at.name === "let") {
        this.raise(Errors.LetInLexicalBinding, {
          at
        });
      }
      if (!(bindingType & 64)) {
        this.declareNameFromIdentifier(at, bindingType);
      }
    }
    declareNameFromIdentifier(identifier, binding) {
      this.scope.declareName(identifier.name, binding, identifier.loc.start);
    }
    checkToRestConversion(node, allowPattern) {
      switch (node.type) {
        case "ParenthesizedExpression":
          this.checkToRestConversion(node.expression, allowPattern);
          break;
        case "Identifier":
        case "MemberExpression":
          break;
        case "ArrayExpression":
        case "ObjectExpression":
          if (allowPattern) break;
        default:
          this.raise(Errors.InvalidRestAssignmentPattern, {
            at: node
          });
      }
    }
    checkCommaAfterRest(close) {
      if (!this.match(12)) {
        return false;
      }
      this.raise(this.lookaheadCharCode() === close ? Errors.RestTrailingComma : Errors.ElementAfterRest, {
        at: this.state.startLoc
      });
      return true;
    }
  }
  // 表达式解析
  class ExpressionParser extends LValParser {
    checkProto(prop, isRecord, protoRef, refExpressionErrors) {
      if (prop.type === "SpreadElement" || this.isObjectMethod(prop) || prop.computed || prop.shorthand) {
        return;
      }
      const key = prop.key;
      const name = key.type === "Identifier" ? key.name : key.value;
      if (name === "__proto__") {
        if (isRecord) {
          this.raise(Errors.RecordNoProto, {
            at: key
          });
          return;
        }
        if (protoRef.used) {
          if (refExpressionErrors) {
            if (refExpressionErrors.doubleProtoLoc === null) {
              refExpressionErrors.doubleProtoLoc = key.loc.start;
            }
          } else {
            this.raise(Errors.DuplicateProto, {
              at: key
            });
          }
        }
        protoRef.used = true;
      }
    }
    shouldExitDescending(expr, potentialArrowAt) {
      return expr.type === "ArrowFunctionExpression" && expr.start === potentialArrowAt;
    }
    getExpression() {
      this.enterInitialScopes();
      this.nextToken();
      const expr = this.parseExpression();
      if (!this.match(137)) {
        this.unexpected();
      }
      this.finalizeRemainingComments();
      expr.comments = this.state.comments;
      expr.errors = this.state.errors;
      if (this.options.tokens) {
        expr.tokens = this.tokens;
      }
      return expr;
    }
    parseExpression(disallowIn, refExpressionErrors) {
      if (disallowIn) {
        return this.disallowInAnd(() => this.parseExpressionBase(refExpressionErrors));
      }
      return this.allowInAnd(() => this.parseExpressionBase(refExpressionErrors));
    }
    parseExpressionBase(refExpressionErrors) {
      const startLoc = this.state.startLoc;
      const expr = this.parseMaybeAssign(refExpressionErrors);
      if (this.match(12)) {
        const node = this.startNodeAt(startLoc);
        node.expressions = [expr];
        while (this.eat(12)) {
          node.expressions.push(this.parseMaybeAssign(refExpressionErrors));
        }
        this.toReferencedList(node.expressions);
        return this.finishNode(node, "SequenceExpression");
      }
      return expr;
    }
    parseMaybeAssignDisallowIn(refExpressionErrors, afterLeftParse) {
      return this.disallowInAnd(() => this.parseMaybeAssign(refExpressionErrors, afterLeftParse));
    }
    parseMaybeAssignAllowIn(refExpressionErrors, afterLeftParse) {
      return this.allowInAnd(() => this.parseMaybeAssign(refExpressionErrors, afterLeftParse));
    }
    setOptionalParametersError(refExpressionErrors, resultError) {
      var _resultError$loc;
      refExpressionErrors.optionalParametersLoc = (_resultError$loc = resultError == null ? void 0 : resultError.loc) != null ? _resultError$loc : this.state.startLoc;
    }
    parseMaybeAssign(refExpressionErrors, afterLeftParse) {
      const startLoc = this.state.startLoc;
      if (this.isContextual(106)) {
        if (this.prodParam.hasYield) {
          let left = this.parseYield();
          if (afterLeftParse) {
            left = afterLeftParse.call(this, left, startLoc);
          }
          return left;
        }
      }
      let ownExpressionErrors;
      if (refExpressionErrors) {
        ownExpressionErrors = false;
      } else {
        refExpressionErrors = new ExpressionErrors();
        ownExpressionErrors = true;
      }
      const {
        type
      } = this.state;
      if (type === 10 || tokenIsIdentifier(type)) {
        this.state.potentialArrowAt = this.state.start;
      }
      let left = this.parseMaybeConditional(refExpressionErrors);
      if (afterLeftParse) {
        left = afterLeftParse.call(this, left, startLoc);
      }
      if (tokenIsAssignment(this.state.type)) {
        const node = this.startNodeAt(startLoc);
        const operator = this.state.value;
        node.operator = operator;
        if (this.match(29)) {
          this.toAssignable(left, true);
          node.left = left;
          const startIndex = startLoc.index;
          if (refExpressionErrors.doubleProtoLoc != null && refExpressionErrors.doubleProtoLoc.index >= startIndex) {
            refExpressionErrors.doubleProtoLoc = null;
          }
          if (refExpressionErrors.shorthandAssignLoc != null && refExpressionErrors.shorthandAssignLoc.index >= startIndex) {
            refExpressionErrors.shorthandAssignLoc = null;
          }
          if (refExpressionErrors.privateKeyLoc != null && refExpressionErrors.privateKeyLoc.index >= startIndex) {
            this.checkDestructuringPrivate(refExpressionErrors);
            refExpressionErrors.privateKeyLoc = null;
          }
        } else {
          node.left = left;
        }
        this.next();
        node.right = this.parseMaybeAssign();
        this.checkLVal(left, {
          in: this.finishNode(node, "AssignmentExpression")
        });
        return node;
      } else if (ownExpressionErrors) {
        this.checkExpressionErrors(refExpressionErrors, true);
      }
      return left;
    }
    parseMaybeConditional(refExpressionErrors) {
      const startLoc = this.state.startLoc;
      const potentialArrowAt = this.state.potentialArrowAt;
      const expr = this.parseExprOps(refExpressionErrors);
      if (this.shouldExitDescending(expr, potentialArrowAt)) {
        return expr;
      }
      return this.parseConditional(expr, startLoc, refExpressionErrors);
    }
    parseConditional(expr, startLoc, refExpressionErrors) {
      if (this.eat(17)) {
        const node = this.startNodeAt(startLoc);
        node.test = expr;
        node.consequent = this.parseMaybeAssignAllowIn();
        this.expect(14);
        node.alternate = this.parseMaybeAssign();
        return this.finishNode(node, "ConditionalExpression");
      }
      return expr;
    }
    parseMaybeUnaryOrPrivate(refExpressionErrors) {
      return this.match(136) ? this.parsePrivateName() : this.parseMaybeUnary(refExpressionErrors);
    }
    parseExprOps(refExpressionErrors) {
      const startLoc = this.state.startLoc;
      const potentialArrowAt = this.state.potentialArrowAt;
      const expr = this.parseMaybeUnaryOrPrivate(refExpressionErrors);
      if (this.shouldExitDescending(expr, potentialArrowAt)) {
        return expr;
      }
      return this.parseExprOp(expr, startLoc, -1);
    }
    parseExprOp(left, leftStartLoc, minPrec) {
      if (this.isPrivateName(left)) {
        const value = this.getPrivateNameSV(left);
        if (minPrec >= tokenOperatorPrecedence(58) || !this.prodParam.hasIn || !this.match(58)) {
          this.raise(Errors.PrivateInExpectedIn, {
            at: left,
            identifierName: value
          });
        }
        this.classScope.usePrivateName(value, left.loc.start);
      }
      const op = this.state.type;
      if (tokenIsOperator(op) && (this.prodParam.hasIn || !this.match(58))) {
        let prec = tokenOperatorPrecedence(op);
        if (prec > minPrec) {
          if (op === 39) {
            this.expectPlugin("pipelineOperator");
            if (this.state.inFSharpPipelineDirectBody) {
              return left;
            }
            this.checkPipelineAtInfixOperator(left, leftStartLoc);
          }
          const node = this.startNodeAt(leftStartLoc);
          node.left = left;
          node.operator = this.state.value;
          const logical = op === 41 || op === 42;
          const coalesce = op === 40;
          if (coalesce) {
            prec = tokenOperatorPrecedence(42);
          }
          this.next();
          if (op === 39 && this.hasPlugin(["pipelineOperator", {
            proposal: "minimal"
          }])) {
            if (this.state.type === 96 && this.prodParam.hasAwait) {
              throw this.raise(Errors.UnexpectedAwaitAfterPipelineBody, {
                at: this.state.startLoc
              });
            }
          }
          node.right = this.parseExprOpRightExpr(op, prec);
          const finishedNode = this.finishNode(node, logical || coalesce ? "LogicalExpression" : "BinaryExpression");
          const nextOp = this.state.type;
          if (coalesce && (nextOp === 41 || nextOp === 42) || logical && nextOp === 40) {
            throw this.raise(Errors.MixingCoalesceWithLogical, {
              at: this.state.startLoc
            });
          }
          return this.parseExprOp(finishedNode, leftStartLoc, minPrec);
        }
      }
      return left;
    }
    parseExprOpRightExpr(op, prec) {
      const startLoc = this.state.startLoc;
      switch (op) {
        case 39:
          switch (this.getPluginOption("pipelineOperator", "proposal")) {
            case "hack":
              return this.withTopicBindingContext(() => {
                return this.parseHackPipeBody();
              });
            case "smart":
              return this.withTopicBindingContext(() => {
                if (this.prodParam.hasYield && this.isContextual(106)) {
                  throw this.raise(Errors.PipeBodyIsTighter, {
                    at: this.state.startLoc
                  });
                }
                return this.parseSmartPipelineBodyInStyle(this.parseExprOpBaseRightExpr(op, prec), startLoc);
              });
            case "fsharp":
              return this.withSoloAwaitPermittingContext(() => {
                return this.parseFSharpPipelineBody(prec);
              });
          }
        default:
          return this.parseExprOpBaseRightExpr(op, prec);
      }
    }
    parseExprOpBaseRightExpr(op, prec) {
      const startLoc = this.state.startLoc;
      return this.parseExprOp(this.parseMaybeUnaryOrPrivate(), startLoc, tokenIsRightAssociative(op) ? prec - 1 : prec);
    }
    parseHackPipeBody() {
      var _body$extra;
      const {
        startLoc
      } = this.state;
      const body = this.parseMaybeAssign();
      const requiredParentheses = UnparenthesizedPipeBodyDescriptions.has(body.type);
      if (requiredParentheses && !((_body$extra = body.extra) != null && _body$extra.parenthesized)) {
        this.raise(Errors.PipeUnparenthesizedBody, {
          at: startLoc,
          type: body.type
        });
      }
      if (!this.topicReferenceWasUsedInCurrentContext()) {
        this.raise(Errors.PipeTopicUnused, {
          at: startLoc
        });
      }
      return body;
    }
    checkExponentialAfterUnary(node) {
      if (this.match(57)) {
        this.raise(Errors.UnexpectedTokenUnaryExponentiation, {
          at: node.argument
        });
      }
    }
    parseMaybeUnary(refExpressionErrors, sawUnary) {
      const startLoc = this.state.startLoc;
      const isAwait = this.isContextual(96);
      if (isAwait && this.isAwaitAllowed()) {
        this.next();
        const expr = this.parseAwait(startLoc);
        if (!sawUnary) this.checkExponentialAfterUnary(expr);
        return expr;
      }
      const update = this.match(34);
      const node = this.startNode();
      if (tokenIsPrefix(this.state.type)) {
        node.operator = this.state.value;
        node.prefix = true;
        if (this.match(72)) {
          this.expectPlugin("throwExpressions");
        }
        const isDelete = this.match(89);
        this.next();
        node.argument = this.parseMaybeUnary(null, true);
        this.checkExpressionErrors(refExpressionErrors, true);
        if (this.state.strict && isDelete) {
          const arg = node.argument;
          if (arg.type === "Identifier") {
            this.raise(Errors.StrictDelete, {
              at: node
            });
          } else if (this.hasPropertyAsPrivateName(arg)) {
            this.raise(Errors.DeletePrivateField, {
              at: node
            });
          }
        }
        if (!update) {
          if (!sawUnary) {
            this.checkExponentialAfterUnary(node);
          }
          return this.finishNode(node, "UnaryExpression");
        }
      }
      const expr = this.parseUpdate(node, update, refExpressionErrors);
      if (isAwait) {
        const {
          type
        } = this.state;
        const startsExpr = this.hasPlugin("v8intrinsic") ? tokenCanStartExpression(type) : tokenCanStartExpression(type) && !this.match(54);
        if (startsExpr && !this.isAmbiguousAwait()) {
          this.raiseOverwrite(Errors.AwaitNotInAsyncContext, {
            at: startLoc
          });
          return this.parseAwait(startLoc);
        }
      }
      return expr;
    }
    parseUpdate(node, update, refExpressionErrors) {
      if (update) {
        const updateExpressionNode = node;
        this.checkLVal(updateExpressionNode.argument, {
          in: this.finishNode(updateExpressionNode, "UpdateExpression")
        });
        return node;
      }
      const startLoc = this.state.startLoc;
      let expr = this.parseExprSubscripts(refExpressionErrors);
      if (this.checkExpressionErrors(refExpressionErrors, false)) return expr;
      while (tokenIsPostfix(this.state.type) && !this.canInsertSemicolon()) {
        const node = this.startNodeAt(startLoc);
        node.operator = this.state.value;
        node.prefix = false;
        node.argument = expr;
        this.next();
        this.checkLVal(expr, {
          in: expr = this.finishNode(node, "UpdateExpression")
        });
      }
      return expr;
    }
    parseExprSubscripts(refExpressionErrors) {
      const startLoc = this.state.startLoc;
      const potentialArrowAt = this.state.potentialArrowAt;
      const expr = this.parseExprAtom(refExpressionErrors);
      if (this.shouldExitDescending(expr, potentialArrowAt)) {
        return expr;
      }
      return this.parseSubscripts(expr, startLoc);
    }
    parseSubscripts(base, startLoc, noCalls) {
      const state = {
        optionalChainMember: false,
        maybeAsyncArrow: this.atPossibleAsyncArrow(base),
        stop: false
      };
      do {
        base = this.parseSubscript(base, startLoc, noCalls, state);
        state.maybeAsyncArrow = false;
      } while (!state.stop);
      return base;
    }
    parseSubscript(base, startLoc, noCalls, state) {
      const {
        type
      } = this.state;
      if (!noCalls && type === 15) {
        return this.parseBind(base, startLoc, noCalls, state);
      } else if (tokenIsTemplate(type)) {
        return this.parseTaggedTemplateExpression(base, startLoc, state);
      }
      let optional = false;
      if (type === 18) {
        if (noCalls) {
          this.raise(Errors.OptionalChainingNoNew, {
            at: this.state.startLoc
          });
          if (this.lookaheadCharCode() === 40) {
            state.stop = true;
            return base;
          }
        }
        state.optionalChainMember = optional = true;
        this.next();
      }
      if (!noCalls && this.match(10)) {
        return this.parseCoverCallAndAsyncArrowHead(base, startLoc, state, optional);
      } else {
        const computed = this.eat(0);
        if (computed || optional || this.eat(16)) {
          return this.parseMember(base, startLoc, state, computed, optional);
        } else {
          state.stop = true;
          return base;
        }
      }
    }
    parseMember(base, startLoc, state, computed, optional) {
      const node = this.startNodeAt(startLoc);
      node.object = base;
      node.computed = computed;
      if (computed) {
        node.property = this.parseExpression();
        this.expect(3);
      } else if (this.match(136)) {
        if (base.type === "Super") {
          this.raise(Errors.SuperPrivateField, {
            at: startLoc
          });
        }
        this.classScope.usePrivateName(this.state.value, this.state.startLoc);
        node.property = this.parsePrivateName();
      } else {
        node.property = this.parseIdentifier(true);
      }
      if (state.optionalChainMember) {
        node.optional = optional;
        return this.finishNode(node, "OptionalMemberExpression");
      } else {
        return this.finishNode(node, "MemberExpression");
      }
    }
    parseBind(base, startLoc, noCalls, state) {
      const node = this.startNodeAt(startLoc);
      node.object = base;
      this.next();
      node.callee = this.parseNoCallExpr();
      state.stop = true;
      return this.parseSubscripts(this.finishNode(node, "BindExpression"), startLoc, noCalls);
    }
    parseCoverCallAndAsyncArrowHead(base, startLoc, state, optional) {
      const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
      let refExpressionErrors = null;
      this.state.maybeInArrowParameters = true;
      this.next();
      const node = this.startNodeAt(startLoc);
      node.callee = base;
      const {
        maybeAsyncArrow,
        optionalChainMember
      } = state;
      if (maybeAsyncArrow) {
        this.expressionScope.enter(newAsyncArrowScope());
        refExpressionErrors = new ExpressionErrors();
      }
      if (optionalChainMember) {
        node.optional = optional;
      }
      if (optional) {
        node.arguments = this.parseCallExpressionArguments(11);
      } else {
        node.arguments = this.parseCallExpressionArguments(11, base.type === "Import", base.type !== "Super", node, refExpressionErrors);
      }
      let finishedNode = this.finishCallExpression(node, optionalChainMember);
      if (maybeAsyncArrow && this.shouldParseAsyncArrow() && !optional) {
        state.stop = true;
        this.checkDestructuringPrivate(refExpressionErrors);
        this.expressionScope.validateAsPattern();
        this.expressionScope.exit();
        finishedNode = this.parseAsyncArrowFromCallExpression(this.startNodeAt(startLoc), finishedNode);
      } else {
        if (maybeAsyncArrow) {
          this.checkExpressionErrors(refExpressionErrors, true);
          this.expressionScope.exit();
        }
        this.toReferencedArguments(finishedNode);
      }
      this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
      return finishedNode;
    }
    toReferencedArguments(node, isParenthesizedExpr) {
      this.toReferencedListDeep(node.arguments, isParenthesizedExpr);
    }
    parseTaggedTemplateExpression(base, startLoc, state) {
      const node = this.startNodeAt(startLoc);
      node.tag = base;
      node.quasi = this.parseTemplate(true);
      if (state.optionalChainMember) {
        this.raise(Errors.OptionalChainingNoTemplate, {
          at: startLoc
        });
      }
      return this.finishNode(node, "TaggedTemplateExpression");
    }
    atPossibleAsyncArrow(base) {
      return base.type === "Identifier" && base.name === "async" && this.state.lastTokEndLoc.index === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 && base.start === this.state.potentialArrowAt;
    }
    expectImportAttributesPlugin() {
      if (!this.hasPlugin("importAssertions")) {
        this.expectPlugin("importAttributes");
      }
    }
    finishCallExpression(node, optional) {
      if (node.callee.type === "Import") {
        if (node.arguments.length === 2) {
          {
            if (!this.hasPlugin("moduleAttributes")) {
              this.expectImportAttributesPlugin();
            }
          }
        }
        if (node.arguments.length === 0 || node.arguments.length > 2) {
          this.raise(Errors.ImportCallArity, {
            at: node,
            maxArgumentCount: this.hasPlugin("importAttributes") || this.hasPlugin("importAssertions") || this.hasPlugin("moduleAttributes") ? 2 : 1
          });
        } else {
          for (const arg of node.arguments) {
            if (arg.type === "SpreadElement") {
              this.raise(Errors.ImportCallSpreadArgument, {
                at: arg
              });
            }
          }
        }
      }
      return this.finishNode(node, optional ? "OptionalCallExpression" : "CallExpression");
    }
    parseCallExpressionArguments(close, dynamicImport, allowPlaceholder, nodeForExtra, refExpressionErrors) {
      const elts = [];
      let first = true;
      const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
      this.state.inFSharpPipelineDirectBody = false;
      while (!this.eat(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(12);
          if (this.match(close)) {
            if (dynamicImport && !this.hasPlugin("importAttributes") && !this.hasPlugin("importAssertions") && !this.hasPlugin("moduleAttributes")) {
              this.raise(Errors.ImportCallArgumentTrailingComma, {
                at: this.state.lastTokStartLoc
              });
            }
            if (nodeForExtra) {
              this.addTrailingCommaExtraToNode(nodeForExtra);
            }
            this.next();
            break;
          }
        }
        elts.push(this.parseExprListItem(false, refExpressionErrors, allowPlaceholder));
      }
      this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
      return elts;
    }
    shouldParseAsyncArrow() {
      return this.match(19) && !this.canInsertSemicolon();
    }
    parseAsyncArrowFromCallExpression(node, call) {
      var _call$extra;
      this.resetPreviousNodeTrailingComments(call);
      this.expect(19);
      this.parseArrowExpression(node, call.arguments, true, (_call$extra = call.extra) == null ? void 0 : _call$extra.trailingCommaLoc);
      if (call.innerComments) {
        setInnerComments(node, call.innerComments);
      }
      if (call.callee.trailingComments) {
        setInnerComments(node, call.callee.trailingComments);
      }
      return node;
    }
    parseNoCallExpr() {
      const startLoc = this.state.startLoc;
      return this.parseSubscripts(this.parseExprAtom(), startLoc, true);
    }
    parseExprAtom(refExpressionErrors) {
      let node;
      let decorators = null;
      const {
        type
      } = this.state;
      switch (type) {
        case 79:
          return this.parseSuper();
        case 83:
          node = this.startNode();
          this.next();
          if (this.match(16)) {
            return this.parseImportMetaProperty(node);
          }
          if (!this.match(10)) {
            this.raise(Errors.UnsupportedImport, {
              at: this.state.lastTokStartLoc
            });
          }
          return this.finishNode(node, "Import");
        case 78:
          node = this.startNode();
          this.next();
          return this.finishNode(node, "ThisExpression");
        case 90:
          {
            return this.parseDo(this.startNode(), false);
          }
        case 56:
        case 31:
          {
            this.readRegexp();
            return this.parseRegExpLiteral(this.state.value);
          }
        case 132:
          return this.parseNumericLiteral(this.state.value);
        case 133:
          return this.parseBigIntLiteral(this.state.value);
        case 134:
          return this.parseDecimalLiteral(this.state.value);
        case 131:
          return this.parseStringLiteral(this.state.value);
        case 84:
          return this.parseNullLiteral();
        case 85:
          return this.parseBooleanLiteral(true);
        case 86:
          return this.parseBooleanLiteral(false);
        case 10:
          {
            const canBeArrow = this.state.potentialArrowAt === this.state.start;
            return this.parseParenAndDistinguishExpression(canBeArrow);
          }
        case 2:
        case 1:
          {
            return this.parseArrayLike(this.state.type === 2 ? 4 : 3, false, true);
          }
        case 0:
          {
            return this.parseArrayLike(3, true, false, refExpressionErrors);
          }
        case 6:
        case 7:
          {
            return this.parseObjectLike(this.state.type === 6 ? 9 : 8, false, true);
          }
        case 5:
          {
            return this.parseObjectLike(8, false, false, refExpressionErrors);
          }
        case 68:
          return this.parseFunctionOrFunctionSent();
        case 26:
          decorators = this.parseDecorators();
        case 80:
          return this.parseClass(this.maybeTakeDecorators(decorators, this.startNode()), false);
        case 77:
          return this.parseNewOrNewTarget();
        case 25:
        case 24:
          return this.parseTemplate(false);
        case 15:
          {
            node = this.startNode();
            this.next();
            node.object = null;
            const callee = node.callee = this.parseNoCallExpr();
            if (callee.type === "MemberExpression") {
              return this.finishNode(node, "BindExpression");
            } else {
              throw this.raise(Errors.UnsupportedBind, {
                at: callee
              });
            }
          }
        case 136:
          {
            this.raise(Errors.PrivateInExpectedIn, {
              at: this.state.startLoc,
              identifierName: this.state.value
            });
            return this.parsePrivateName();
          }
        case 33:
          {
            return this.parseTopicReferenceThenEqualsSign(54, "%");
          }
        case 32:
          {
            return this.parseTopicReferenceThenEqualsSign(44, "^");
          }
        case 37:
        case 38:
          {
            return this.parseTopicReference("hack");
          }
        case 44:
        case 54:
        case 27:
          {
            const pipeProposal = this.getPluginOption("pipelineOperator", "proposal");
            if (pipeProposal) {
              return this.parseTopicReference(pipeProposal);
            }
            this.unexpected();
            break;
          }
        case 47:
          {
            const lookaheadCh = this.input.codePointAt(this.nextTokenStart());
            if (isIdentifierStart(lookaheadCh) || lookaheadCh === 62) {
              this.expectOnePlugin(["jsx", "flow", "typescript"]);
            } else {
              this.unexpected();
            }
            break;
          }
        default:
          if (tokenIsIdentifier(type)) {
            if (this.isContextual(125) && this.lookaheadInLineCharCode() === 123) {
              return this.parseModuleExpression();
            }
            const canBeArrow = this.state.potentialArrowAt === this.state.start;
            const containsEsc = this.state.containsEsc;
            const id = this.parseIdentifier();
            if (!containsEsc && id.name === "async" && !this.canInsertSemicolon()) {
              const {
                type
              } = this.state;
              if (type === 68) {
                this.resetPreviousNodeTrailingComments(id);
                this.next();
                return this.parseAsyncFunctionExpression(this.startNodeAtNode(id));
              } else if (tokenIsIdentifier(type)) {
                if (this.lookaheadCharCode() === 61) {
                  return this.parseAsyncArrowUnaryFunction(this.startNodeAtNode(id));
                } else {
                  return id;
                }
              } else if (type === 90) {
                this.resetPreviousNodeTrailingComments(id);
                return this.parseDo(this.startNodeAtNode(id), true);
              }
            }
            if (canBeArrow && this.match(19) && !this.canInsertSemicolon()) {
              this.next();
              return this.parseArrowExpression(this.startNodeAtNode(id), [id], false);
            }
            return id;
          } else {
            this.unexpected();
          }
      }
    }
    parseTopicReferenceThenEqualsSign(topicTokenType, topicTokenValue) {
      const pipeProposal = this.getPluginOption("pipelineOperator", "proposal");
      if (pipeProposal) {
        this.state.type = topicTokenType;
        this.state.value = topicTokenValue;
        this.state.pos--;
        this.state.end--;
        this.state.endLoc = createPositionWithColumnOffset(this.state.endLoc, -1);
        return this.parseTopicReference(pipeProposal);
      } else {
        this.unexpected();
      }
    }
    parseTopicReference(pipeProposal) {
      const node = this.startNode();
      const startLoc = this.state.startLoc;
      const tokenType = this.state.type;
      this.next();
      return this.finishTopicReference(node, startLoc, pipeProposal, tokenType);
    }
    finishTopicReference(node, startLoc, pipeProposal, tokenType) {
      if (this.testTopicReferenceConfiguration(pipeProposal, startLoc, tokenType)) {
        const nodeType = pipeProposal === "smart" ? "PipelinePrimaryTopicReference" : "TopicReference";
        if (!this.topicReferenceIsAllowedInCurrentContext()) {
          this.raise(pipeProposal === "smart" ? Errors.PrimaryTopicNotAllowed : Errors.PipeTopicUnbound, {
            at: startLoc
          });
        }
        this.registerTopicReference();
        return this.finishNode(node, nodeType);
      } else {
        throw this.raise(Errors.PipeTopicUnconfiguredToken, {
          at: startLoc,
          token: tokenLabelName(tokenType)
        });
      }
    }
    testTopicReferenceConfiguration(pipeProposal, startLoc, tokenType) {
      switch (pipeProposal) {
        case "hack":
          {
            return this.hasPlugin(["pipelineOperator", {
              topicToken: tokenLabelName(tokenType)
            }]);
          }
        case "smart":
          return tokenType === 27;
        default:
          throw this.raise(Errors.PipeTopicRequiresHackPipes, {
            at: startLoc
          });
      }
    }
    parseAsyncArrowUnaryFunction(node) {
      this.prodParam.enter(functionFlags(true, this.prodParam.hasYield));
      const params = [this.parseIdentifier()];
      this.prodParam.exit();
      if (this.hasPrecedingLineBreak()) {
        this.raise(Errors.LineTerminatorBeforeArrow, {
          at: this.state.curPosition()
        });
      }
      this.expect(19);
      return this.parseArrowExpression(node, params, true);
    }
    parseDo(node, isAsync) {
      this.expectPlugin("doExpressions");
      if (isAsync) {
        this.expectPlugin("asyncDoExpressions");
      }
      node.async = isAsync;
      this.next();
      const oldLabels = this.state.labels;
      this.state.labels = [];
      if (isAsync) {
        this.prodParam.enter(PARAM_AWAIT);
        node.body = this.parseBlock();
        this.prodParam.exit();
      } else {
        node.body = this.parseBlock();
      }
      this.state.labels = oldLabels;
      return this.finishNode(node, "DoExpression");
    }
    parseSuper() {
      const node = this.startNode();
      this.next();
      if (this.match(10) && !this.scope.allowDirectSuper && !this.options.allowSuperOutsideMethod) {
        this.raise(Errors.SuperNotAllowed, {
          at: node
        });
      } else if (!this.scope.allowSuper && !this.options.allowSuperOutsideMethod) {
        this.raise(Errors.UnexpectedSuper, {
          at: node
        });
      }
      if (!this.match(10) && !this.match(0) && !this.match(16)) {
        this.raise(Errors.UnsupportedSuper, {
          at: node
        });
      }
      return this.finishNode(node, "Super");
    }
    parsePrivateName() {
      const node = this.startNode();
      const id = this.startNodeAt(createPositionWithColumnOffset(this.state.startLoc, 1));
      const name = this.state.value;
      this.next();
      node.id = this.createIdentifier(id, name);
      return this.finishNode(node, "PrivateName");
    }
    parseFunctionOrFunctionSent() {
      const node = this.startNode();
      this.next();
      if (this.prodParam.hasYield && this.match(16)) {
        const meta = this.createIdentifier(this.startNodeAtNode(node), "function");
        this.next();
        if (this.match(102)) {
          this.expectPlugin("functionSent");
        } else if (!this.hasPlugin("functionSent")) {
          this.unexpected();
        }
        return this.parseMetaProperty(node, meta, "sent");
      }
      return this.parseFunction(node);
    }
    parseMetaProperty(node, meta, propertyName) {
      node.meta = meta;
      const containsEsc = this.state.containsEsc;
      node.property = this.parseIdentifier(true);
      if (node.property.name !== propertyName || containsEsc) {
        this.raise(Errors.UnsupportedMetaProperty, {
          at: node.property,
          target: meta.name,
          onlyValidPropertyName: propertyName
        });
      }
      return this.finishNode(node, "MetaProperty");
    }
    parseImportMetaProperty(node) {
      const id = this.createIdentifier(this.startNodeAtNode(node), "import");
      this.next();
      if (this.isContextual(100)) {
        if (!this.inModule) {
          this.raise(Errors.ImportMetaOutsideModule, {
            at: id
          });
        }
        this.sawUnambiguousESM = true;
      }
      return this.parseMetaProperty(node, id, "meta");
    }
    parseLiteralAtNode(value, type, node) {
      this.addExtra(node, "rawValue", value);
      this.addExtra(node, "raw", this.input.slice(node.start, this.state.end));
      node.value = value;
      this.next();
      return this.finishNode(node, type);
    }
    parseLiteral(value, type) {
      const node = this.startNode();
      return this.parseLiteralAtNode(value, type, node);
    }
    parseStringLiteral(value) {
      return this.parseLiteral(value, "StringLiteral");
    }
    parseNumericLiteral(value) {
      return this.parseLiteral(value, "NumericLiteral");
    }
    parseBigIntLiteral(value) {
      return this.parseLiteral(value, "BigIntLiteral");
    }
    parseDecimalLiteral(value) {
      return this.parseLiteral(value, "DecimalLiteral");
    }
    parseRegExpLiteral(value) {
      const node = this.parseLiteral(value.value, "RegExpLiteral");
      node.pattern = value.pattern;
      node.flags = value.flags;
      return node;
    }
    parseBooleanLiteral(value) {
      const node = this.startNode();
      node.value = value;
      this.next();
      return this.finishNode(node, "BooleanLiteral");
    }
    parseNullLiteral() {
      const node = this.startNode();
      this.next();
      return this.finishNode(node, "NullLiteral");
    }
    parseParenAndDistinguishExpression(canBeArrow) {
      const startLoc = this.state.startLoc;
      let val;
      this.next();
      this.expressionScope.enter(newArrowHeadScope());
      const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
      const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
      this.state.maybeInArrowParameters = true;
      this.state.inFSharpPipelineDirectBody = false;
      const innerStartLoc = this.state.startLoc;
      const exprList = [];
      const refExpressionErrors = new ExpressionErrors();
      let first = true;
      let spreadStartLoc;
      let optionalCommaStartLoc;
      while (!this.match(11)) {
        if (first) {
          first = false;
        } else {
          this.expect(12, refExpressionErrors.optionalParametersLoc === null ? null : refExpressionErrors.optionalParametersLoc);
          if (this.match(11)) {
            optionalCommaStartLoc = this.state.startLoc;
            break;
          }
        }
        if (this.match(21)) {
          const spreadNodeStartLoc = this.state.startLoc;
          spreadStartLoc = this.state.startLoc;
          exprList.push(this.parseParenItem(this.parseRestBinding(), spreadNodeStartLoc));
          if (!this.checkCommaAfterRest(41)) {
            break;
          }
        } else {
          exprList.push(this.parseMaybeAssignAllowIn(refExpressionErrors, this.parseParenItem));
        }
      }
      const innerEndLoc = this.state.lastTokEndLoc;
      this.expect(11);
      this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
      this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
      let arrowNode = this.startNodeAt(startLoc);
      if (canBeArrow && this.shouldParseArrow(exprList) && (arrowNode = this.parseArrow(arrowNode))) {
        this.checkDestructuringPrivate(refExpressionErrors);
        this.expressionScope.validateAsPattern();
        this.expressionScope.exit();
        this.parseArrowExpression(arrowNode, exprList, false);
        return arrowNode;
      }
      this.expressionScope.exit();
      if (!exprList.length) {
        this.unexpected(this.state.lastTokStartLoc);
      }
      if (optionalCommaStartLoc) this.unexpected(optionalCommaStartLoc);
      if (spreadStartLoc) this.unexpected(spreadStartLoc);
      this.checkExpressionErrors(refExpressionErrors, true);
      this.toReferencedListDeep(exprList, true);
      if (exprList.length > 1) {
        val = this.startNodeAt(innerStartLoc);
        val.expressions = exprList;
        this.finishNode(val, "SequenceExpression");
        this.resetEndLocation(val, innerEndLoc);
      } else {
        val = exprList[0];
      }
      return this.wrapParenthesis(startLoc, val);
    }
    wrapParenthesis(startLoc, expression) {
      if (!this.options.createParenthesizedExpressions) {
        this.addExtra(expression, "parenthesized", true);
        this.addExtra(expression, "parenStart", startLoc.index);
        this.takeSurroundingComments(expression, startLoc.index, this.state.lastTokEndLoc.index);
        return expression;
      }
      const parenExpression = this.startNodeAt(startLoc);
      parenExpression.expression = expression;
      return this.finishNode(parenExpression, "ParenthesizedExpression");
    }
    shouldParseArrow(params) {
      return !this.canInsertSemicolon();
    }
    parseArrow(node) {
      if (this.eat(19)) {
        return node;
      }
    }
    parseParenItem(node, startLoc) {
      return node;
    }
    parseNewOrNewTarget() {
      const node = this.startNode();
      this.next();
      if (this.match(16)) {
        const meta = this.createIdentifier(this.startNodeAtNode(node), "new");
        this.next();
        const metaProp = this.parseMetaProperty(node, meta, "target");
        if (!this.scope.inNonArrowFunction && !this.scope.inClass && !this.options.allowNewTargetOutsideFunction) {
          this.raise(Errors.UnexpectedNewTarget, {
            at: metaProp
          });
        }
        return metaProp;
      }
      return this.parseNew(node);
    }
    parseNew(node) {
      this.parseNewCallee(node);
      if (this.eat(10)) {
        const args = this.parseExprList(11);
        this.toReferencedList(args);
        node.arguments = args;
      } else {
        node.arguments = [];
      }
      return this.finishNode(node, "NewExpression");
    }
    parseNewCallee(node) {
      node.callee = this.parseNoCallExpr();
      if (node.callee.type === "Import") {
        this.raise(Errors.ImportCallNotNewExpression, {
          at: node.callee
        });
      }
    }
    parseTemplateElement(isTagged) {
      const {
        start,
        startLoc,
        end,
        value
      } = this.state;
      const elemStart = start + 1;
      const elem = this.startNodeAt(createPositionWithColumnOffset(startLoc, 1));
      if (value === null) {
        if (!isTagged) {
          this.raise(Errors.InvalidEscapeSequenceTemplate, {
            at: createPositionWithColumnOffset(this.state.firstInvalidTemplateEscapePos, 1)
          });
        }
      }
      const isTail = this.match(24);
      const endOffset = isTail ? -1 : -2;
      const elemEnd = end + endOffset;
      elem.value = {
        raw: this.input.slice(elemStart, elemEnd).replace(/\r\n?/g, "\n"),
        cooked: value === null ? null : value.slice(1, endOffset)
      };
      elem.tail = isTail;
      this.next();
      const finishedNode = this.finishNode(elem, "TemplateElement");
      this.resetEndLocation(finishedNode, createPositionWithColumnOffset(this.state.lastTokEndLoc, endOffset));
      return finishedNode;
    }
    parseTemplate(isTagged) {
      const node = this.startNode();
      node.expressions = [];
      let curElt = this.parseTemplateElement(isTagged);
      node.quasis = [curElt];
      while (!curElt.tail) {
        node.expressions.push(this.parseTemplateSubstitution());
        this.readTemplateContinuation();
        node.quasis.push(curElt = this.parseTemplateElement(isTagged));
      }
      return this.finishNode(node, "TemplateLiteral");
    }
    parseTemplateSubstitution() {
      return this.parseExpression();
    }
    parseObjectLike(close, isPattern, isRecord, refExpressionErrors) {
      if (isRecord) {
        this.expectPlugin("recordAndTuple");
      }
      const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
      this.state.inFSharpPipelineDirectBody = false;
      const propHash = Object.create(null);
      let first = true;
      const node = this.startNode();
      node.properties = [];
      this.next();
      while (!this.match(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(12);
          if (this.match(close)) {
            this.addTrailingCommaExtraToNode(node);
            break;
          }
        }
        let prop;
        if (isPattern) {
          prop = this.parseBindingProperty();
        } else {
          prop = this.parsePropertyDefinition(refExpressionErrors);
          this.checkProto(prop, isRecord, propHash, refExpressionErrors);
        }
        if (isRecord && !this.isObjectProperty(prop) && prop.type !== "SpreadElement") {
          this.raise(Errors.InvalidRecordProperty, {
            at: prop
          });
        }
        if (prop.shorthand) {
          this.addExtra(prop, "shorthand", true);
        }
        node.properties.push(prop);
      }
      this.next();
      this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
      let type = "ObjectExpression";
      if (isPattern) {
        type = "ObjectPattern";
      } else if (isRecord) {
        type = "RecordExpression";
      }
      return this.finishNode(node, type);
    }
    addTrailingCommaExtraToNode(node) {
      this.addExtra(node, "trailingComma", this.state.lastTokStart);
      this.addExtra(node, "trailingCommaLoc", this.state.lastTokStartLoc, false);
    }
    maybeAsyncOrAccessorProp(prop) {
      return !prop.computed && prop.key.type === "Identifier" && (this.isLiteralPropertyName() || this.match(0) || this.match(55));
    }
    parsePropertyDefinition(refExpressionErrors) {
      let decorators = [];
      if (this.match(26)) {
        if (this.hasPlugin("decorators")) {
          this.raise(Errors.UnsupportedPropertyDecorator, {
            at: this.state.startLoc
          });
        }
        while (this.match(26)) {
          decorators.push(this.parseDecorator());
        }
      }
      const prop = this.startNode();
      let isAsync = false;
      let isAccessor = false;
      let startLoc;
      if (this.match(21)) {
        if (decorators.length) this.unexpected();
        return this.parseSpread();
      }
      if (decorators.length) {
        prop.decorators = decorators;
        decorators = [];
      }
      prop.method = false;
      if (refExpressionErrors) {
        startLoc = this.state.startLoc;
      }
      let isGenerator = this.eat(55);
      this.parsePropertyNamePrefixOperator(prop);
      const containsEsc = this.state.containsEsc;
      const key = this.parsePropertyName(prop, refExpressionErrors);
      if (!isGenerator && !containsEsc && this.maybeAsyncOrAccessorProp(prop)) {
        const keyName = key.name;
        if (keyName === "async" && !this.hasPrecedingLineBreak()) {
          isAsync = true;
          this.resetPreviousNodeTrailingComments(key);
          isGenerator = this.eat(55);
          this.parsePropertyName(prop);
        }
        if (keyName === "get" || keyName === "set") {
          isAccessor = true;
          this.resetPreviousNodeTrailingComments(key);
          prop.kind = keyName;
          if (this.match(55)) {
            isGenerator = true;
            this.raise(Errors.AccessorIsGenerator, {
              at: this.state.curPosition(),
              kind: keyName
            });
            this.next();
          }
          this.parsePropertyName(prop);
        }
      }
      return this.parseObjPropValue(prop, startLoc, isGenerator, isAsync, false, isAccessor, refExpressionErrors);
    }
    getGetterSetterExpectedParamCount(method) {
      return method.kind === "get" ? 0 : 1;
    }
    getObjectOrClassMethodParams(method) {
      return method.params;
    }
    checkGetterSetterParams(method) {
      var _params;
      const paramCount = this.getGetterSetterExpectedParamCount(method);
      const params = this.getObjectOrClassMethodParams(method);
      if (params.length !== paramCount) {
        this.raise(method.kind === "get" ? Errors.BadGetterArity : Errors.BadSetterArity, {
          at: method
        });
      }
      if (method.kind === "set" && ((_params = params[params.length - 1]) == null ? void 0 : _params.type) === "RestElement") {
        this.raise(Errors.BadSetterRestParameter, {
          at: method
        });
      }
    }
    parseObjectMethod(prop, isGenerator, isAsync, isPattern, isAccessor) {
      if (isAccessor) {
        const finishedProp = this.parseMethod(prop, isGenerator, false, false, false, "ObjectMethod");
        this.checkGetterSetterParams(finishedProp);
        return finishedProp;
      }
      if (isAsync || isGenerator || this.match(10)) {
        if (isPattern) this.unexpected();
        prop.kind = "method";
        prop.method = true;
        return this.parseMethod(prop, isGenerator, isAsync, false, false, "ObjectMethod");
      }
    }
    parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors) {
      prop.shorthand = false;
      if (this.eat(14)) {
        prop.value = isPattern ? this.parseMaybeDefault(this.state.startLoc) : this.parseMaybeAssignAllowIn(refExpressionErrors);
        return this.finishNode(prop, "ObjectProperty");
      }
      if (!prop.computed && prop.key.type === "Identifier") {
        this.checkReservedWord(prop.key.name, prop.key.loc.start, true, false);
        if (isPattern) {
          prop.value = this.parseMaybeDefault(startLoc, cloneIdentifier(prop.key));
        } else if (this.match(29)) {
          const shorthandAssignLoc = this.state.startLoc;
          if (refExpressionErrors != null) {
            if (refExpressionErrors.shorthandAssignLoc === null) {
              refExpressionErrors.shorthandAssignLoc = shorthandAssignLoc;
            }
          } else {
            this.raise(Errors.InvalidCoverInitializedName, {
              at: shorthandAssignLoc
            });
          }
          prop.value = this.parseMaybeDefault(startLoc, cloneIdentifier(prop.key));
        } else {
          prop.value = cloneIdentifier(prop.key);
        }
        prop.shorthand = true;
        return this.finishNode(prop, "ObjectProperty");
      }
    }
    parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors) {
      const node = this.parseObjectMethod(prop, isGenerator, isAsync, isPattern, isAccessor) || this.parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors);
      if (!node) this.unexpected();
      return node;
    }
    parsePropertyName(prop, refExpressionErrors) {
      if (this.eat(0)) {
        prop.computed = true;
        prop.key = this.parseMaybeAssignAllowIn();
        this.expect(3);
      } else {
        const {
          type,
          value
        } = this.state;
        let key;
        if (tokenIsKeywordOrIdentifier(type)) {
          key = this.parseIdentifier(true);
        } else {
          switch (type) {
            case 132:
              key = this.parseNumericLiteral(value);
              break;
            case 131:
              key = this.parseStringLiteral(value);
              break;
            case 133:
              key = this.parseBigIntLiteral(value);
              break;
            case 134:
              key = this.parseDecimalLiteral(value);
              break;
            case 136:
              {
                const privateKeyLoc = this.state.startLoc;
                if (refExpressionErrors != null) {
                  if (refExpressionErrors.privateKeyLoc === null) {
                    refExpressionErrors.privateKeyLoc = privateKeyLoc;
                  }
                } else {
                  this.raise(Errors.UnexpectedPrivateField, {
                    at: privateKeyLoc
                  });
                }
                key = this.parsePrivateName();
                break;
              }
            default:
              this.unexpected();
          }
        }
        prop.key = key;
        if (type !== 136) {
          prop.computed = false;
        }
      }
      return prop.key;
    }
    initFunction(node, isAsync) {
      node.id = null;
      node.generator = false;
      node.async = isAsync;
    }
    parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope = false) {
      this.initFunction(node, isAsync);
      node.generator = isGenerator;
      this.scope.enter(2 | 16 | (inClassScope ? 64 : 0) | (allowDirectSuper ? 32 : 0));
      this.prodParam.enter(functionFlags(isAsync, node.generator));
      this.parseFunctionParams(node, isConstructor);
      const finishedNode = this.parseFunctionBodyAndFinish(node, type, true);
      this.prodParam.exit();
      this.scope.exit();
      return finishedNode;
    }
    parseArrayLike(close, canBePattern, isTuple, refExpressionErrors) {
      if (isTuple) {
        this.expectPlugin("recordAndTuple");
      }
      const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
      this.state.inFSharpPipelineDirectBody = false;
      const node = this.startNode();
      this.next();
      node.elements = this.parseExprList(close, !isTuple, refExpressionErrors, node);
      this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
      return this.finishNode(node, isTuple ? "TupleExpression" : "ArrayExpression");
    }
    parseArrowExpression(node, params, isAsync, trailingCommaLoc) {
      this.scope.enter(2 | 4);
      let flags = functionFlags(isAsync, false);
      if (!this.match(5) && this.prodParam.hasIn) {
        flags |= PARAM_IN;
      }
      this.prodParam.enter(flags);
      this.initFunction(node, isAsync);
      const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
      if (params) {
        this.state.maybeInArrowParameters = true;
        this.setArrowFunctionParameters(node, params, trailingCommaLoc);
      }
      this.state.maybeInArrowParameters = false;
      this.parseFunctionBody(node, true);
      this.prodParam.exit();
      this.scope.exit();
      this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
      return this.finishNode(node, "ArrowFunctionExpression");
    }
    setArrowFunctionParameters(node, params, trailingCommaLoc) {
      this.toAssignableList(params, trailingCommaLoc, false);
      node.params = params;
    }
    parseFunctionBodyAndFinish(node, type, isMethod = false) {
      this.parseFunctionBody(node, false, isMethod);
      return this.finishNode(node, type);
    }
    parseFunctionBody(node, allowExpression, isMethod = false) {
      const isExpression = allowExpression && !this.match(5);
      this.expressionScope.enter(newExpressionScope());
      if (isExpression) {
        node.body = this.parseMaybeAssign();
        this.checkParams(node, false, allowExpression, false);
      } else {
        const oldStrict = this.state.strict;
        const oldLabels = this.state.labels;
        this.state.labels = [];
        this.prodParam.enter(this.prodParam.currentFlags() | PARAM_RETURN);
        node.body = this.parseBlock(true, false, hasStrictModeDirective => {
          const nonSimple = !this.isSimpleParamList(node.params);
          if (hasStrictModeDirective && nonSimple) {
            this.raise(Errors.IllegalLanguageModeDirective, {
              at: (node.kind === "method" || node.kind === "constructor") && !!node.key ? node.key.loc.end : node
            });
          }
          const strictModeChanged = !oldStrict && this.state.strict;
          this.checkParams(node, !this.state.strict && !allowExpression && !isMethod && !nonSimple, allowExpression, strictModeChanged);
          if (this.state.strict && node.id) {
            this.checkIdentifier(node.id, 65, strictModeChanged);
          }
        });
        this.prodParam.exit();
        this.state.labels = oldLabels;
      }
      this.expressionScope.exit();
    }
    isSimpleParameter(node) {
      return node.type === "Identifier";
    }
    isSimpleParamList(params) {
      for (let i = 0, len = params.length; i < len; i++) {
        if (!this.isSimpleParameter(params[i])) return false;
      }
      return true;
    }
    checkParams(node, allowDuplicates, isArrowFunction, strictModeChanged = true) {
      const checkClashes = !allowDuplicates && new Set();
      const formalParameters = {
        type: "FormalParameters"
      };
      for (const param of node.params) {
        this.checkLVal(param, {
          in: formalParameters,
          binding: 5,
          checkClashes,
          strictModeChanged
        });
      }
    }
    parseExprList(close, allowEmpty, refExpressionErrors, nodeForExtra) {
      const elts = [];
      let first = true;
      while (!this.eat(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(12);
          if (this.match(close)) {
            if (nodeForExtra) {
              this.addTrailingCommaExtraToNode(nodeForExtra);
            }
            this.next();
            break;
          }
        }
        elts.push(this.parseExprListItem(allowEmpty, refExpressionErrors));
      }
      return elts;
    }
    parseExprListItem(allowEmpty, refExpressionErrors, allowPlaceholder) {
      let elt;
      if (this.match(12)) {
        if (!allowEmpty) {
          this.raise(Errors.UnexpectedToken, {
            at: this.state.curPosition(),
            unexpected: ","
          });
        }
        elt = null;
      } else if (this.match(21)) {
        const spreadNodeStartLoc = this.state.startLoc;
        elt = this.parseParenItem(this.parseSpread(refExpressionErrors), spreadNodeStartLoc);
      } else if (this.match(17)) {
        this.expectPlugin("partialApplication");
        if (!allowPlaceholder) {
          this.raise(Errors.UnexpectedArgumentPlaceholder, {
            at: this.state.startLoc
          });
        }
        const node = this.startNode();
        this.next();
        elt = this.finishNode(node, "ArgumentPlaceholder");
      } else {
        elt = this.parseMaybeAssignAllowIn(refExpressionErrors, this.parseParenItem);
      }
      return elt;
    }
    parseIdentifier(liberal) {
      const node = this.startNode();
      const name = this.parseIdentifierName(liberal);
      return this.createIdentifier(node, name);
    }
    createIdentifier(node, name) {
      node.name = name;
      node.loc.identifierName = name;
      return this.finishNode(node, "Identifier");
    }
    parseIdentifierName(liberal) {
      let name;
      const {
        startLoc,
        type
      } = this.state;
      if (tokenIsKeywordOrIdentifier(type)) {
        name = this.state.value;
      } else {
        this.unexpected();
      }
      const tokenIsKeyword = tokenKeywordOrIdentifierIsKeyword(type);
      if (liberal) {
        if (tokenIsKeyword) {
          this.replaceToken(130);
        }
      } else {
        this.checkReservedWord(name, startLoc, tokenIsKeyword, false);
      }
      this.next();
      return name;
    }
    checkReservedWord(word, startLoc, checkKeywords, isBinding) {
      if (word.length > 10) {
        return;
      }
      if (!canBeReservedWord(word)) {
        return;
      }
      if (checkKeywords && isKeyword(word)) {
        this.raise(Errors.UnexpectedKeyword, {
          at: startLoc,
          keyword: word
        });
        return;
      }
      const reservedTest = !this.state.strict ? isReservedWord : isBinding ? isStrictBindReservedWord : isStrictReservedWord;
      if (reservedTest(word, this.inModule)) {
        this.raise(Errors.UnexpectedReservedWord, {
          at: startLoc,
          reservedWord: word
        });
        return;
      } else if (word === "yield") {
        if (this.prodParam.hasYield) {
          this.raise(Errors.YieldBindingIdentifier, {
            at: startLoc
          });
          return;
        }
      } else if (word === "await") {
        if (this.prodParam.hasAwait) {
          this.raise(Errors.AwaitBindingIdentifier, {
            at: startLoc
          });
          return;
        }
        if (this.scope.inStaticBlock) {
          this.raise(Errors.AwaitBindingIdentifierInStaticBlock, {
            at: startLoc
          });
          return;
        }
        this.expressionScope.recordAsyncArrowParametersError({
          at: startLoc
        });
      } else if (word === "arguments") {
        if (this.scope.inClassAndNotInNonArrowFunction) {
          this.raise(Errors.ArgumentsInClass, {
            at: startLoc
          });
          return;
        }
      }
    }
    isAwaitAllowed() {
      if (this.prodParam.hasAwait) return true;
      if (this.options.allowAwaitOutsideFunction && !this.scope.inFunction) {
        return true;
      }
      return false;
    }
    parseAwait(startLoc) {
      const node = this.startNodeAt(startLoc);
      this.expressionScope.recordParameterInitializerError(Errors.AwaitExpressionFormalParameter, {
        at: node
      });
      if (this.eat(55)) {
        this.raise(Errors.ObsoleteAwaitStar, {
          at: node
        });
      }
      if (!this.scope.inFunction && !this.options.allowAwaitOutsideFunction) {
        if (this.isAmbiguousAwait()) {
          this.ambiguousScriptDifferentAst = true;
        } else {
          this.sawUnambiguousESM = true;
        }
      }
      if (!this.state.soloAwait) {
        node.argument = this.parseMaybeUnary(null, true);
      }
      return this.finishNode(node, "AwaitExpression");
    }
    isAmbiguousAwait() {
      if (this.hasPrecedingLineBreak()) return true;
      const {
        type
      } = this.state;
      return type === 53 || type === 10 || type === 0 || tokenIsTemplate(type) || type === 101 && !this.state.containsEsc || type === 135 || type === 56 || this.hasPlugin("v8intrinsic") && type === 54;
    }
    parseYield() {
      const node = this.startNode();
      this.expressionScope.recordParameterInitializerError(Errors.YieldInParameter, {
        at: node
      });
      this.next();
      let delegating = false;
      let argument = null;
      if (!this.hasPrecedingLineBreak()) {
        delegating = this.eat(55);
        switch (this.state.type) {
          case 13:
          case 137:
          case 8:
          case 11:
          case 3:
          case 9:
          case 14:
          case 12:
            if (!delegating) break;
          default:
            argument = this.parseMaybeAssign();
        }
      }
      node.delegate = delegating;
      node.argument = argument;
      return this.finishNode(node, "YieldExpression");
    }
    checkPipelineAtInfixOperator(left, leftStartLoc) {
      if (this.hasPlugin(["pipelineOperator", {
        proposal: "smart"
      }])) {
        if (left.type === "SequenceExpression") {
          this.raise(Errors.PipelineHeadSequenceExpression, {
            at: leftStartLoc
          });
        }
      }
    }
    parseSmartPipelineBodyInStyle(childExpr, startLoc) {
      if (this.isSimpleReference(childExpr)) {
        const bodyNode = this.startNodeAt(startLoc);
        bodyNode.callee = childExpr;
        return this.finishNode(bodyNode, "PipelineBareFunction");
      } else {
        const bodyNode = this.startNodeAt(startLoc);
        this.checkSmartPipeTopicBodyEarlyErrors(startLoc);
        bodyNode.expression = childExpr;
        return this.finishNode(bodyNode, "PipelineTopicExpression");
      }
    }
    isSimpleReference(expression) {
      switch (expression.type) {
        case "MemberExpression":
          return !expression.computed && this.isSimpleReference(expression.object);
        case "Identifier":
          return true;
        default:
          return false;
      }
    }
    checkSmartPipeTopicBodyEarlyErrors(startLoc) {
      if (this.match(19)) {
        throw this.raise(Errors.PipelineBodyNoArrow, {
          at: this.state.startLoc
        });
      }
      if (!this.topicReferenceWasUsedInCurrentContext()) {
        this.raise(Errors.PipelineTopicUnused, {
          at: startLoc
        });
      }
    }
    withTopicBindingContext(callback) {
      const outerContextTopicState = this.state.topicContext;
      this.state.topicContext = {
        maxNumOfResolvableTopics: 1,
        maxTopicIndex: null
      };
      try {
        return callback();
      } finally {
        this.state.topicContext = outerContextTopicState;
      }
    }
    withSmartMixTopicForbiddingContext(callback) {
      if (this.hasPlugin(["pipelineOperator", {
        proposal: "smart"
      }])) {
        const outerContextTopicState = this.state.topicContext;
        this.state.topicContext = {
          maxNumOfResolvableTopics: 0,
          maxTopicIndex: null
        };
        try {
          return callback();
        } finally {
          this.state.topicContext = outerContextTopicState;
        }
      } else {
        return callback();
      }
    }
    withSoloAwaitPermittingContext(callback) {
      const outerContextSoloAwaitState = this.state.soloAwait;
      this.state.soloAwait = true;
      try {
        return callback();
      } finally {
        this.state.soloAwait = outerContextSoloAwaitState;
      }
    }
    allowInAnd(callback) {
      const flags = this.prodParam.currentFlags();
      const prodParamToSet = PARAM_IN & ~flags;
      if (prodParamToSet) {
        this.prodParam.enter(flags | PARAM_IN);
        try {
          return callback();
        } finally {
          this.prodParam.exit();
        }
      }
      return callback();
    }
    disallowInAnd(callback) {
      const flags = this.prodParam.currentFlags();
      const prodParamToClear = PARAM_IN & flags;
      if (prodParamToClear) {
        this.prodParam.enter(flags & ~PARAM_IN);
        try {
          return callback();
        } finally {
          this.prodParam.exit();
        }
      }
      return callback();
    }
    registerTopicReference() {
      this.state.topicContext.maxTopicIndex = 0;
    }
    topicReferenceIsAllowedInCurrentContext() {
      return this.state.topicContext.maxNumOfResolvableTopics >= 1;
    }
    topicReferenceWasUsedInCurrentContext() {
      return this.state.topicContext.maxTopicIndex != null && this.state.topicContext.maxTopicIndex >= 0;
    }
    parseFSharpPipelineBody(prec) {
      const startLoc = this.state.startLoc;
      this.state.potentialArrowAt = this.state.start;
      const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
      this.state.inFSharpPipelineDirectBody = true;
      const ret = this.parseExprOp(this.parseMaybeUnaryOrPrivate(), startLoc, prec);
      this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
      return ret;
    }
    parseModuleExpression() {
      this.expectPlugin("moduleBlocks");
      const node = this.startNode();
      this.next();
      if (!this.match(5)) {
        this.unexpected(null, 5);
      }
      const program = this.startNodeAt(this.state.endLoc);
      this.next();
      const revertScopes = this.initializeScopes(true);
      this.enterInitialScopes();
      try {
        node.body = this.parseProgram(program, 8, "module");
      } finally {
        revertScopes();
      }
      return this.finishNode(node, "ModuleExpression");
    }
    parsePropertyNamePrefixOperator(prop) {}
  }
  // 语法分析
  class StatementParser extends ExpressionParser {
    parseTopLevel(file, program) {
      file.program = this.parseProgram(program);
      file.comments = this.state.comments;
      if (this.options.tokens) {
        file.tokens = babel7CompatTokens(this.tokens, this.input);
      }
      return this.finishNode(file, "File");
    }
    parseProgram(program, end = 137, sourceType = this.options.sourceType) {
      program.sourceType = sourceType;
      program.interpreter = this.parseInterpreterDirective();
      this.parseBlockBody(program, true, true, end);
      if (this.inModule && !this.options.allowUndeclaredExports && this.scope.undefinedExports.size > 0) {
        for (const [localName, at] of Array.from(this.scope.undefinedExports)) {
          this.raise(Errors.ModuleExportUndefined, {
            at,
            localName
          });
        }
      }
      let finishedProgram;
      if (end === 137) {
        finishedProgram = this.finishNode(program, "Program");
      } else {
        finishedProgram = this.finishNodeAt(program, "Program", createPositionWithColumnOffset(this.state.startLoc, -1));
      }
      return finishedProgram;
    }
    stmtToDirective(stmt) {
      const directive = stmt;
      directive.type = "Directive";
      directive.value = directive.expression;
      delete directive.expression;
      const directiveLiteral = directive.value;
      const expressionValue = directiveLiteral.value;
      const raw = this.input.slice(directiveLiteral.start, directiveLiteral.end);
      const val = directiveLiteral.value = raw.slice(1, -1);
      this.addExtra(directiveLiteral, "raw", raw);
      this.addExtra(directiveLiteral, "rawValue", val);
      this.addExtra(directiveLiteral, "expressionValue", expressionValue);
      directiveLiteral.type = "DirectiveLiteral";
      return directive;
    }
    parseInterpreterDirective() {
      if (!this.match(28)) {
        return null;
      }
      const node = this.startNode();
      node.value = this.state.value;
      this.next();
      return this.finishNode(node, "InterpreterDirective");
    }
    isLet() {
      if (!this.isContextual(99)) {
        return false;
      }
      return this.hasFollowingBindingAtom();
    }
    chStartsBindingIdentifier(ch, pos) {
      if (isIdentifierStart(ch)) {
        keywordRelationalOperator.lastIndex = pos;
        if (keywordRelationalOperator.test(this.input)) {
          const endCh = this.codePointAtPos(keywordRelationalOperator.lastIndex);
          if (!isIdentifierChar(endCh) && endCh !== 92) {
            return false;
          }
        }
        return true;
      } else if (ch === 92) {
        return true;
      } else {
        return false;
      }
    }
    chStartsBindingPattern(ch) {
      return ch === 91 || ch === 123;
    }
    hasFollowingBindingAtom() {
      const next = this.nextTokenStart();
      const nextCh = this.codePointAtPos(next);
      return this.chStartsBindingPattern(nextCh) || this.chStartsBindingIdentifier(nextCh, next);
    }
    hasInLineFollowingBindingIdentifier() {
      const next = this.nextTokenInLineStart();
      const nextCh = this.codePointAtPos(next);
      return this.chStartsBindingIdentifier(nextCh, next);
    }
    startsUsingForOf() {
      const {
        type,
        containsEsc
      } = this.lookahead();
      if (type === 101 && !containsEsc) {
        return false;
      } else if (tokenIsIdentifier(type) && !this.hasFollowingLineBreak()) {
        this.expectPlugin("explicitResourceManagement");
        return true;
      }
    }
    startsAwaitUsing() {
      let next = this.nextTokenInLineStart();
      if (this.isUnparsedContextual(next, "using")) {
        next = this.nextTokenInLineStartSince(next + 5);
        const nextCh = this.codePointAtPos(next);
        if (this.chStartsBindingIdentifier(nextCh, next)) {
          this.expectPlugin("explicitResourceManagement");
          return true;
        }
      }
      return false;
    }
    parseModuleItem() {
      return this.parseStatementLike(1 | 2 | 4 | 8);
    }
    parseStatementListItem() {
      return this.parseStatementLike(2 | 4 | (!this.options.annexB || this.state.strict ? 0 : 8));
    }
    parseStatementOrSloppyAnnexBFunctionDeclaration(allowLabeledFunction = false) {
      let flags = 0;
      if (this.options.annexB && !this.state.strict) {
        flags |= 4;
        if (allowLabeledFunction) {
          flags |= 8;
        }
      }
      return this.parseStatementLike(flags);
    }
    parseStatement() {
      return this.parseStatementLike(0);
    }
    parseStatementLike(flags) {
      let decorators = null;
      if (this.match(26)) {
        decorators = this.parseDecorators(true);
      }
      return this.parseStatementContent(flags, decorators);
    }
    parseStatementContent(flags, decorators) {
      const starttype = this.state.type;
      const node = this.startNode();
      const allowDeclaration = !!(flags & 2);
      const allowFunctionDeclaration = !!(flags & 4);
      const topLevel = flags & 1;
      switch (starttype) {
        case 60:
          return this.parseBreakContinueStatement(node, true);
        case 63:
          return this.parseBreakContinueStatement(node, false);
        case 64:
          return this.parseDebuggerStatement(node);
        case 90:
          return this.parseDoWhileStatement(node);
        case 91:
          return this.parseForStatement(node);
        case 68:
          if (this.lookaheadCharCode() === 46) break;
          if (!allowFunctionDeclaration) {
            this.raise(this.state.strict ? Errors.StrictFunction : this.options.annexB ? Errors.SloppyFunctionAnnexB : Errors.SloppyFunction, {
              at: this.state.startLoc
            });
          }
          return this.parseFunctionStatement(node, false, !allowDeclaration && allowFunctionDeclaration);
        case 80:
          if (!allowDeclaration) this.unexpected();
          return this.parseClass(this.maybeTakeDecorators(decorators, node), true);
        case 69:
          return this.parseIfStatement(node);
        case 70:
          return this.parseReturnStatement(node);
        case 71:
          return this.parseSwitchStatement(node);
        case 72:
          return this.parseThrowStatement(node);
        case 73:
          return this.parseTryStatement(node);
        case 96:
          if (!this.state.containsEsc && this.startsAwaitUsing()) {
            if (!this.isAwaitAllowed()) {
              this.raise(Errors.AwaitUsingNotInAsyncContext, {
                at: node
              });
            } else if (!allowDeclaration) {
              this.raise(Errors.UnexpectedLexicalDeclaration, {
                at: node
              });
            }
            this.next();
            return this.parseVarStatement(node, "await using");
          }
          break;
        case 105:
          if (this.state.containsEsc || !this.hasInLineFollowingBindingIdentifier()) {
            break;
          }
          this.expectPlugin("explicitResourceManagement");
          if (!this.scope.inModule && this.scope.inTopLevel) {
            this.raise(Errors.UnexpectedUsingDeclaration, {
              at: this.state.startLoc
            });
          } else if (!allowDeclaration) {
            this.raise(Errors.UnexpectedLexicalDeclaration, {
              at: this.state.startLoc
            });
          }
          return this.parseVarStatement(node, "using");
        case 99:
          {
            if (this.state.containsEsc) {
              break;
            }
            const next = this.nextTokenStart();
            const nextCh = this.codePointAtPos(next);
            if (nextCh !== 91) {
              if (!allowDeclaration && this.hasFollowingLineBreak()) break;
              if (!this.chStartsBindingIdentifier(nextCh, next) && nextCh !== 123) {
                break;
              }
            }
          }
        case 75:
          {
            if (!allowDeclaration) {
              this.raise(Errors.UnexpectedLexicalDeclaration, {
                at: this.state.startLoc
              });
            }
          }
        case 74:
          {
            const kind = this.state.value;
            return this.parseVarStatement(node, kind);
          }
        case 92:
          return this.parseWhileStatement(node);
        case 76:
          return this.parseWithStatement(node);
        case 5:
          return this.parseBlock();
        case 13:
          return this.parseEmptyStatement(node);
        case 83:
          {
            const nextTokenCharCode = this.lookaheadCharCode();
            if (nextTokenCharCode === 40 || nextTokenCharCode === 46) {
              break;
            }
          }
        case 82:
          {
            if (!this.options.allowImportExportEverywhere && !topLevel) {
              this.raise(Errors.UnexpectedImportExport, {
                at: this.state.startLoc
              });
            }
            this.next();
            let result;
            if (starttype === 83) {
              result = this.parseImport(node);
              if (result.type === "ImportDeclaration" && (!result.importKind || result.importKind === "value")) {
                this.sawUnambiguousESM = true;
              }
            } else {
              result = this.parseExport(node, decorators);
              if (result.type === "ExportNamedDeclaration" && (!result.exportKind || result.exportKind === "value") || result.type === "ExportAllDeclaration" && (!result.exportKind || result.exportKind === "value") || result.type === "ExportDefaultDeclaration") {
                this.sawUnambiguousESM = true;
              }
            }
            this.assertModuleNodeAllowed(result);
            return result;
          }
        default:
          {
            if (this.isAsyncFunction()) {
              if (!allowDeclaration) {
                this.raise(Errors.AsyncFunctionInSingleStatementContext, {
                  at: this.state.startLoc
                });
              }
              this.next();
              return this.parseFunctionStatement(node, true, !allowDeclaration && allowFunctionDeclaration);
            }
          }
      }
      const maybeName = this.state.value;
      const expr = this.parseExpression();
      if (tokenIsIdentifier(starttype) && expr.type === "Identifier" && this.eat(14)) {
        return this.parseLabeledStatement(node, maybeName, expr, flags);
      } else {
        return this.parseExpressionStatement(node, expr, decorators);
      }
    }
    assertModuleNodeAllowed(node) {
      if (!this.options.allowImportExportEverywhere && !this.inModule) {
        this.raise(Errors.ImportOutsideModule, {
          at: node
        });
      }
    }
    decoratorsEnabledBeforeExport() {
      if (this.hasPlugin("decorators-legacy")) return true;
      return this.hasPlugin("decorators") && this.getPluginOption("decorators", "decoratorsBeforeExport") !== false;
    }
    maybeTakeDecorators(maybeDecorators, classNode, exportNode) {
      if (maybeDecorators) {
        if (classNode.decorators && classNode.decorators.length > 0) {
          if (typeof this.getPluginOption("decorators", "decoratorsBeforeExport") !== "boolean") {
            this.raise(Errors.DecoratorsBeforeAfterExport, {
              at: classNode.decorators[0]
            });
          }
          classNode.decorators.unshift(...maybeDecorators);
        } else {
          classNode.decorators = maybeDecorators;
        }
        this.resetStartLocationFromNode(classNode, maybeDecorators[0]);
        if (exportNode) this.resetStartLocationFromNode(exportNode, classNode);
      }
      return classNode;
    }
    canHaveLeadingDecorator() {
      return this.match(80);
    }
    parseDecorators(allowExport) {
      const decorators = [];
      do {
        decorators.push(this.parseDecorator());
      } while (this.match(26));
      if (this.match(82)) {
        if (!allowExport) {
          this.unexpected();
        }
        if (!this.decoratorsEnabledBeforeExport()) {
          this.raise(Errors.DecoratorExportClass, {
            at: this.state.startLoc
          });
        }
      } else if (!this.canHaveLeadingDecorator()) {
        throw this.raise(Errors.UnexpectedLeadingDecorator, {
          at: this.state.startLoc
        });
      }
      return decorators;
    }
    parseDecorator() {
      this.expectOnePlugin(["decorators", "decorators-legacy"]);
      const node = this.startNode();
      this.next();
      if (this.hasPlugin("decorators")) {
        const startLoc = this.state.startLoc;
        let expr;
        if (this.match(10)) {
          const startLoc = this.state.startLoc;
          this.next();
          expr = this.parseExpression();
          this.expect(11);
          expr = this.wrapParenthesis(startLoc, expr);
          const paramsStartLoc = this.state.startLoc;
          node.expression = this.parseMaybeDecoratorArguments(expr);
          if (this.getPluginOption("decorators", "allowCallParenthesized") === false && node.expression !== expr) {
            this.raise(Errors.DecoratorArgumentsOutsideParentheses, {
              at: paramsStartLoc
            });
          }
        } else {
          expr = this.parseIdentifier(false);
          while (this.eat(16)) {
            const node = this.startNodeAt(startLoc);
            node.object = expr;
            if (this.match(136)) {
              this.classScope.usePrivateName(this.state.value, this.state.startLoc);
              node.property = this.parsePrivateName();
            } else {
              node.property = this.parseIdentifier(true);
            }
            node.computed = false;
            expr = this.finishNode(node, "MemberExpression");
          }
          node.expression = this.parseMaybeDecoratorArguments(expr);
        }
      } else {
        node.expression = this.parseExprSubscripts();
      }
      return this.finishNode(node, "Decorator");
    }
    parseMaybeDecoratorArguments(expr) {
      if (this.eat(10)) {
        const node = this.startNodeAtNode(expr);
        node.callee = expr;
        node.arguments = this.parseCallExpressionArguments(11, false);
        this.toReferencedList(node.arguments);
        return this.finishNode(node, "CallExpression");
      }
      return expr;
    }
    parseBreakContinueStatement(node, isBreak) {
      this.next();
      if (this.isLineTerminator()) {
        node.label = null;
      } else {
        node.label = this.parseIdentifier();
        this.semicolon();
      }
      this.verifyBreakContinue(node, isBreak);
      return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
    }
    verifyBreakContinue(node, isBreak) {
      let i;
      for (i = 0; i < this.state.labels.length; ++i) {
        const lab = this.state.labels[i];
        if (node.label == null || lab.name === node.label.name) {
          if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
          if (node.label && isBreak) break;
        }
      }
      if (i === this.state.labels.length) {
        const type = isBreak ? "BreakStatement" : "ContinueStatement";
        this.raise(Errors.IllegalBreakContinue, {
          at: node,
          type
        });
      }
    }
    parseDebuggerStatement(node) {
      this.next();
      this.semicolon();
      return this.finishNode(node, "DebuggerStatement");
    }
    parseHeaderExpression() {
      this.expect(10);
      const val = this.parseExpression();
      this.expect(11);
      return val;
    }
    parseDoWhileStatement(node) {
      this.next();
      this.state.labels.push(loopLabel);
      node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
      this.state.labels.pop();
      this.expect(92);
      node.test = this.parseHeaderExpression();
      this.eat(13);
      return this.finishNode(node, "DoWhileStatement");
    }
    parseForStatement(node) {
      this.next();
      this.state.labels.push(loopLabel);
      let awaitAt = null;
      if (this.isAwaitAllowed() && this.eatContextual(96)) {
        awaitAt = this.state.lastTokStartLoc;
      }
      this.scope.enter(0);
      this.expect(10);
      if (this.match(13)) {
        if (awaitAt !== null) {
          this.unexpected(awaitAt);
        }
        return this.parseFor(node, null);
      }
      const startsWithLet = this.isContextual(99);
      {
        const startsWithAwaitUsing = this.isContextual(96) && this.startsAwaitUsing();
        const starsWithUsingDeclaration = startsWithAwaitUsing || this.isContextual(105) && this.startsUsingForOf();
        const isLetOrUsing = startsWithLet && this.hasFollowingBindingAtom() || starsWithUsingDeclaration;
        if (this.match(74) || this.match(75) || isLetOrUsing) {
          const initNode = this.startNode();
          let kind;
          if (startsWithAwaitUsing) {
            kind = "await using";
            if (!this.isAwaitAllowed()) {
              this.raise(Errors.AwaitUsingNotInAsyncContext, {
                at: this.state.startLoc
              });
            }
            this.next();
          } else {
            kind = this.state.value;
          }
          this.next();
          this.parseVar(initNode, true, kind);
          const init = this.finishNode(initNode, "VariableDeclaration");
          const isForIn = this.match(58);
          if (isForIn && starsWithUsingDeclaration) {
            this.raise(Errors.ForInUsing, {
              at: init
            });
          }
          if ((isForIn || this.isContextual(101)) && init.declarations.length === 1) {
            return this.parseForIn(node, init, awaitAt);
          }
          if (awaitAt !== null) {
            this.unexpected(awaitAt);
          }
          return this.parseFor(node, init);
        }
      }
      const startsWithAsync = this.isContextual(95);
      const refExpressionErrors = new ExpressionErrors();
      const init = this.parseExpression(true, refExpressionErrors);
      const isForOf = this.isContextual(101);
      if (isForOf) {
        if (startsWithLet) {
          this.raise(Errors.ForOfLet, {
            at: init
          });
        }
        if (awaitAt === null && startsWithAsync && init.type === "Identifier") {
          this.raise(Errors.ForOfAsync, {
            at: init
          });
        }
      }
      if (isForOf || this.match(58)) {
        this.checkDestructuringPrivate(refExpressionErrors);
        this.toAssignable(init, true);
        const type = isForOf ? "ForOfStatement" : "ForInStatement";
        this.checkLVal(init, {
          in: {
            type
          }
        });
        return this.parseForIn(node, init, awaitAt);
      } else {
        this.checkExpressionErrors(refExpressionErrors, true);
      }
      if (awaitAt !== null) {
        this.unexpected(awaitAt);
      }
      return this.parseFor(node, init);
    }
    parseFunctionStatement(node, isAsync, isHangingDeclaration) {
      this.next();
      return this.parseFunction(node, 1 | (isHangingDeclaration ? 2 : 0) | (isAsync ? 8 : 0));
    }
    parseIfStatement(node) {
      this.next();
      node.test = this.parseHeaderExpression();
      node.consequent = this.parseStatementOrSloppyAnnexBFunctionDeclaration();
      node.alternate = this.eat(66) ? this.parseStatementOrSloppyAnnexBFunctionDeclaration() : null;
      return this.finishNode(node, "IfStatement");
    }
    parseReturnStatement(node) {
      if (!this.prodParam.hasReturn && !this.options.allowReturnOutsideFunction) {
        this.raise(Errors.IllegalReturn, {
          at: this.state.startLoc
        });
      }
      this.next();
      if (this.isLineTerminator()) {
        node.argument = null;
      } else {
        node.argument = this.parseExpression();
        this.semicolon();
      }
      return this.finishNode(node, "ReturnStatement");
    }
    parseSwitchStatement(node) {
      this.next();
      node.discriminant = this.parseHeaderExpression();
      const cases = node.cases = [];
      this.expect(5);
      this.state.labels.push(switchLabel);
      this.scope.enter(0);
      let cur;
      for (let sawDefault; !this.match(8);) {
        if (this.match(61) || this.match(65)) {
          const isCase = this.match(61);
          if (cur) this.finishNode(cur, "SwitchCase");
          cases.push(cur = this.startNode());
          cur.consequent = [];
          this.next();
          if (isCase) {
            cur.test = this.parseExpression();
          } else {
            if (sawDefault) {
              this.raise(Errors.MultipleDefaultsInSwitch, {
                at: this.state.lastTokStartLoc
              });
            }
            sawDefault = true;
            cur.test = null;
          }
          this.expect(14);
        } else {
          if (cur) {
            cur.consequent.push(this.parseStatementListItem());
          } else {
            this.unexpected();
          }
        }
      }
      this.scope.exit();
      if (cur) this.finishNode(cur, "SwitchCase");
      this.next();
      this.state.labels.pop();
      return this.finishNode(node, "SwitchStatement");
    }
    parseThrowStatement(node) {
      this.next();
      if (this.hasPrecedingLineBreak()) {
        this.raise(Errors.NewlineAfterThrow, {
          at: this.state.lastTokEndLoc
        });
      }
      node.argument = this.parseExpression();
      this.semicolon();
      return this.finishNode(node, "ThrowStatement");
    }
    parseCatchClauseParam() {
      const param = this.parseBindingAtom();
      this.scope.enter(this.options.annexB && param.type === "Identifier" ? 8 : 0);
      this.checkLVal(param, {
        in: {
          type: "CatchClause"
        },
        binding: 9
      });
      return param;
    }
    parseTryStatement(node) {
      this.next();
      node.block = this.parseBlock();
      node.handler = null;
      if (this.match(62)) {
        const clause = this.startNode();
        this.next();
        if (this.match(10)) {
          this.expect(10);
          clause.param = this.parseCatchClauseParam();
          this.expect(11);
        } else {
          clause.param = null;
          this.scope.enter(0);
        }
        clause.body = this.withSmartMixTopicForbiddingContext(() => this.parseBlock(false, false));
        this.scope.exit();
        node.handler = this.finishNode(clause, "CatchClause");
      }
      node.finalizer = this.eat(67) ? this.parseBlock() : null;
      if (!node.handler && !node.finalizer) {
        this.raise(Errors.NoCatchOrFinally, {
          at: node
        });
      }
      return this.finishNode(node, "TryStatement");
    }
    parseVarStatement(node, kind, allowMissingInitializer = false) {
      this.next();
      this.parseVar(node, false, kind, allowMissingInitializer);
      this.semicolon();
      return this.finishNode(node, "VariableDeclaration");
    }
    parseWhileStatement(node) {
      this.next();
      node.test = this.parseHeaderExpression();
      this.state.labels.push(loopLabel);
      node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
      this.state.labels.pop();
      return this.finishNode(node, "WhileStatement");
    }
    parseWithStatement(node) {
      if (this.state.strict) {
        this.raise(Errors.StrictWith, {
          at: this.state.startLoc
        });
      }
      this.next();
      node.object = this.parseHeaderExpression();
      node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
      return this.finishNode(node, "WithStatement");
    }
    parseEmptyStatement(node) {
      this.next();
      return this.finishNode(node, "EmptyStatement");
    }
    parseLabeledStatement(node, maybeName, expr, flags) {
      for (const label of this.state.labels) {
        if (label.name === maybeName) {
          this.raise(Errors.LabelRedeclaration, {
            at: expr,
            labelName: maybeName
          });
        }
      }
      const kind = tokenIsLoop(this.state.type) ? "loop" : this.match(71) ? "switch" : null;
      for (let i = this.state.labels.length - 1; i >= 0; i--) {
        const label = this.state.labels[i];
        if (label.statementStart === node.start) {
          label.statementStart = this.state.start;
          label.kind = kind;
        } else {
          break;
        }
      }
      this.state.labels.push({
        name: maybeName,
        kind: kind,
        statementStart: this.state.start
      });
      node.body = flags & 8 ? this.parseStatementOrSloppyAnnexBFunctionDeclaration(true) : this.parseStatement();
      this.state.labels.pop();
      node.label = expr;
      return this.finishNode(node, "LabeledStatement");
    }
    parseExpressionStatement(node, expr, decorators) {
      node.expression = expr;
      this.semicolon();
      return this.finishNode(node, "ExpressionStatement");
    }
    parseBlock(allowDirectives = false, createNewLexicalScope = true, afterBlockParse) {
      const node = this.startNode();
      if (allowDirectives) {
        this.state.strictErrors.clear();
      }
      this.expect(5);
      if (createNewLexicalScope) {
        this.scope.enter(0);
      }
      this.parseBlockBody(node, allowDirectives, false, 8, afterBlockParse);
      if (createNewLexicalScope) {
        this.scope.exit();
      }
      return this.finishNode(node, "BlockStatement");
    }
    isValidDirective(stmt) {
      return stmt.type === "ExpressionStatement" && stmt.expression.type === "StringLiteral" && !stmt.expression.extra.parenthesized;
    }
    parseBlockBody(node, allowDirectives, topLevel, end, afterBlockParse) {
      const body = node.body = [];
      const directives = node.directives = [];
      this.parseBlockOrModuleBlockBody(body, allowDirectives ? directives : undefined, topLevel, end, afterBlockParse);
    }
    parseBlockOrModuleBlockBody(body, directives, topLevel, end, afterBlockParse) {
      const oldStrict = this.state.strict;
      let hasStrictModeDirective = false;
      let parsedNonDirective = false;
      while (!this.match(end)) {
        const stmt = topLevel ? this.parseModuleItem() : this.parseStatementListItem();
        if (directives && !parsedNonDirective) {
          if (this.isValidDirective(stmt)) {
            const directive = this.stmtToDirective(stmt);
            directives.push(directive);
            if (!hasStrictModeDirective && directive.value.value === "use strict") {
              hasStrictModeDirective = true;
              this.setStrict(true);
            }
            continue;
          }
          parsedNonDirective = true;
          this.state.strictErrors.clear();
        }
        body.push(stmt);
      }
      afterBlockParse == null ? void 0 : afterBlockParse.call(this, hasStrictModeDirective);
      if (!oldStrict) {
        this.setStrict(false);
      }
      this.next();
    }
    parseFor(node, init) {
      node.init = init;
      this.semicolon(false);
      node.test = this.match(13) ? null : this.parseExpression();
      this.semicolon(false);
      node.update = this.match(11) ? null : this.parseExpression();
      this.expect(11);
      node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
      this.scope.exit();
      this.state.labels.pop();
      return this.finishNode(node, "ForStatement");
    }
    parseForIn(node, init, awaitAt) {
      const isForIn = this.match(58);
      this.next();
      if (isForIn) {
        if (awaitAt !== null) this.unexpected(awaitAt);
      } else {
        node.await = awaitAt !== null;
      }
      if (init.type === "VariableDeclaration" && init.declarations[0].init != null && (!isForIn || !this.options.annexB || this.state.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")) {
        this.raise(Errors.ForInOfLoopInitializer, {
          at: init,
          type: isForIn ? "ForInStatement" : "ForOfStatement"
        });
      }
      if (init.type === "AssignmentPattern") {
        this.raise(Errors.InvalidLhs, {
          at: init,
          ancestor: {
            type: "ForStatement"
          }
        });
      }
      node.left = init;
      node.right = isForIn ? this.parseExpression() : this.parseMaybeAssignAllowIn();
      this.expect(11);
      node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
      this.scope.exit();
      this.state.labels.pop();
      return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement");
    }
    parseVar(node, isFor, kind, allowMissingInitializer = false) {
      const declarations = node.declarations = [];
      node.kind = kind;
      for (; ;) {
        const decl = this.startNode();
        this.parseVarId(decl, kind);
        decl.init = !this.eat(29) ? null : isFor ? this.parseMaybeAssignDisallowIn() : this.parseMaybeAssignAllowIn();
        if (decl.init === null && !allowMissingInitializer) {
          if (decl.id.type !== "Identifier" && !(isFor && (this.match(58) || this.isContextual(101)))) {
            this.raise(Errors.DeclarationMissingInitializer, {
              at: this.state.lastTokEndLoc,
              kind: "destructuring"
            });
          } else if (kind === "const" && !(this.match(58) || this.isContextual(101))) {
            this.raise(Errors.DeclarationMissingInitializer, {
              at: this.state.lastTokEndLoc,
              kind: "const"
            });
          }
        }
        declarations.push(this.finishNode(decl, "VariableDeclarator"));
        if (!this.eat(12)) break;
      }
      return node;
    }
    parseVarId(decl, kind) {
      const id = this.parseBindingAtom();
      this.checkLVal(id, {
        in: {
          type: "VariableDeclarator"
        },
        binding: kind === "var" ? 5 : 8201
      });
      decl.id = id;
    }
    parseAsyncFunctionExpression(node) {
      return this.parseFunction(node, 8);
    }
    parseFunction(node, flags = 0) {
      const hangingDeclaration = flags & 2;
      const isDeclaration = !!(flags & 1);
      const requireId = isDeclaration && !(flags & 4);
      const isAsync = !!(flags & 8);
      this.initFunction(node, isAsync);
      if (this.match(55)) {
        if (hangingDeclaration) {
          this.raise(Errors.GeneratorInSingleStatementContext, {
            at: this.state.startLoc
          });
        }
        this.next();
        node.generator = true;
      }
      if (isDeclaration) {
        node.id = this.parseFunctionId(requireId);
      }
      const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
      this.state.maybeInArrowParameters = false;
      this.scope.enter(2);
      this.prodParam.enter(functionFlags(isAsync, node.generator));
      if (!isDeclaration) {
        node.id = this.parseFunctionId();
      }
      this.parseFunctionParams(node, false);
      this.withSmartMixTopicForbiddingContext(() => {
        this.parseFunctionBodyAndFinish(node, isDeclaration ? "FunctionDeclaration" : "FunctionExpression");
      });
      this.prodParam.exit();
      this.scope.exit();
      if (isDeclaration && !hangingDeclaration) {
        this.registerFunctionStatementId(node);
      }
      this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
      return node;
    }
    parseFunctionId(requireId) {
      return requireId || tokenIsIdentifier(this.state.type) ? this.parseIdentifier() : null;
    }
    parseFunctionParams(node, isConstructor) {
      this.expect(10);
      this.expressionScope.enter(newParameterDeclarationScope());
      node.params = this.parseBindingList(11, 41, 2 | (isConstructor ? 4 : 0));
      this.expressionScope.exit();
    }
    registerFunctionStatementId(node) {
      if (!node.id) return;
      this.scope.declareName(node.id.name, !this.options.annexB || this.state.strict || node.generator || node.async ? this.scope.treatFunctionsAsVar ? 5 : 8201 : 17, node.id.loc.start);
    }
    parseClass(node, isStatement, optionalId) {
      this.next();
      const oldStrict = this.state.strict;
      this.state.strict = true;
      this.parseClassId(node, isStatement, optionalId);
      this.parseClassSuper(node);
      node.body = this.parseClassBody(!!node.superClass, oldStrict);
      return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
    }
    isClassProperty() {
      return this.match(29) || this.match(13) || this.match(8);
    }
    isClassMethod() {
      return this.match(10);
    }
    isNonstaticConstructor(method) {
      return !method.computed && !method.static && (method.key.name === "constructor" || method.key.value === "constructor");
    }
    parseClassBody(hadSuperClass, oldStrict) {
      this.classScope.enter();
      const state = {
        hadConstructor: false,
        hadSuperClass
      };
      let decorators = [];
      const classBody = this.startNode();
      classBody.body = [];
      this.expect(5);
      this.withSmartMixTopicForbiddingContext(() => {
        while (!this.match(8)) {
          if (this.eat(13)) {
            if (decorators.length > 0) {
              throw this.raise(Errors.DecoratorSemicolon, {
                at: this.state.lastTokEndLoc
              });
            }
            continue;
          }
          if (this.match(26)) {
            decorators.push(this.parseDecorator());
            continue;
          }
          const member = this.startNode();
          if (decorators.length) {
            member.decorators = decorators;
            this.resetStartLocationFromNode(member, decorators[0]);
            decorators = [];
          }
          this.parseClassMember(classBody, member, state);
          if (member.kind === "constructor" && member.decorators && member.decorators.length > 0) {
            this.raise(Errors.DecoratorConstructor, {
              at: member
            });
          }
        }
      });
      this.state.strict = oldStrict;
      this.next();
      if (decorators.length) {
        throw this.raise(Errors.TrailingDecorator, {
          at: this.state.startLoc
        });
      }
      this.classScope.exit();
      return this.finishNode(classBody, "ClassBody");
    }
    parseClassMemberFromModifier(classBody, member) {
      const key = this.parseIdentifier(true);
      if (this.isClassMethod()) {
        const method = member;
        method.kind = "method";
        method.computed = false;
        method.key = key;
        method.static = false;
        this.pushClassMethod(classBody, method, false, false, false, false);
        return true;
      } else if (this.isClassProperty()) {
        const prop = member;
        prop.computed = false;
        prop.key = key;
        prop.static = false;
        classBody.body.push(this.parseClassProperty(prop));
        return true;
      }
      this.resetPreviousNodeTrailingComments(key);
      return false;
    }
    parseClassMember(classBody, member, state) {
      const isStatic = this.isContextual(104);
      if (isStatic) {
        if (this.parseClassMemberFromModifier(classBody, member)) {
          return;
        }
        if (this.eat(5)) {
          this.parseClassStaticBlock(classBody, member);
          return;
        }
      }
      this.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
    }
    parseClassMemberWithIsStatic(classBody, member, state, isStatic) {
      const publicMethod = member;
      const privateMethod = member;
      const publicProp = member;
      const privateProp = member;
      const accessorProp = member;
      const method = publicMethod;
      const publicMember = publicMethod;
      member.static = isStatic;
      this.parsePropertyNamePrefixOperator(member);
      if (this.eat(55)) {
        method.kind = "method";
        const isPrivateName = this.match(136);
        this.parseClassElementName(method);
        if (isPrivateName) {
          this.pushClassPrivateMethod(classBody, privateMethod, true, false);
          return;
        }
        if (this.isNonstaticConstructor(publicMethod)) {
          this.raise(Errors.ConstructorIsGenerator, {
            at: publicMethod.key
          });
        }
        this.pushClassMethod(classBody, publicMethod, true, false, false, false);
        return;
      }
      const isContextual = tokenIsIdentifier(this.state.type) && !this.state.containsEsc;
      const isPrivate = this.match(136);
      const key = this.parseClassElementName(member);
      const maybeQuestionTokenStartLoc = this.state.startLoc;
      this.parsePostMemberNameModifiers(publicMember);
      if (this.isClassMethod()) {
        method.kind = "method";
        if (isPrivate) {
          this.pushClassPrivateMethod(classBody, privateMethod, false, false);
          return;
        }
        const isConstructor = this.isNonstaticConstructor(publicMethod);
        let allowsDirectSuper = false;
        if (isConstructor) {
          publicMethod.kind = "constructor";
          if (state.hadConstructor && !this.hasPlugin("typescript")) {
            this.raise(Errors.DuplicateConstructor, {
              at: key
            });
          }
          if (isConstructor && this.hasPlugin("typescript") && member.override) {
            this.raise(Errors.OverrideOnConstructor, {
              at: key
            });
          }
          state.hadConstructor = true;
          allowsDirectSuper = state.hadSuperClass;
        }
        this.pushClassMethod(classBody, publicMethod, false, false, isConstructor, allowsDirectSuper);
      } else if (this.isClassProperty()) {
        if (isPrivate) {
          this.pushClassPrivateProperty(classBody, privateProp);
        } else {
          this.pushClassProperty(classBody, publicProp);
        }
      } else if (isContextual && key.name === "async" && !this.isLineTerminator()) {
        this.resetPreviousNodeTrailingComments(key);
        const isGenerator = this.eat(55);
        if (publicMember.optional) {
          this.unexpected(maybeQuestionTokenStartLoc);
        }
        method.kind = "method";
        const isPrivate = this.match(136);
        this.parseClassElementName(method);
        this.parsePostMemberNameModifiers(publicMember);
        if (isPrivate) {
          this.pushClassPrivateMethod(classBody, privateMethod, isGenerator, true);
        } else {
          if (this.isNonstaticConstructor(publicMethod)) {
            this.raise(Errors.ConstructorIsAsync, {
              at: publicMethod.key
            });
          }
          this.pushClassMethod(classBody, publicMethod, isGenerator, true, false, false);
        }
      } else if (isContextual && (key.name === "get" || key.name === "set") && !(this.match(55) && this.isLineTerminator())) {
        this.resetPreviousNodeTrailingComments(key);
        method.kind = key.name;
        const isPrivate = this.match(136);
        this.parseClassElementName(publicMethod);
        if (isPrivate) {
          this.pushClassPrivateMethod(classBody, privateMethod, false, false);
        } else {
          if (this.isNonstaticConstructor(publicMethod)) {
            this.raise(Errors.ConstructorIsAccessor, {
              at: publicMethod.key
            });
          }
          this.pushClassMethod(classBody, publicMethod, false, false, false, false);
        }
        this.checkGetterSetterParams(publicMethod);
      } else if (isContextual && key.name === "accessor" && !this.isLineTerminator()) {
        this.expectPlugin("decoratorAutoAccessors");
        this.resetPreviousNodeTrailingComments(key);
        const isPrivate = this.match(136);
        this.parseClassElementName(publicProp);
        this.pushClassAccessorProperty(classBody, accessorProp, isPrivate);
      } else if (this.isLineTerminator()) {
        if (isPrivate) {
          this.pushClassPrivateProperty(classBody, privateProp);
        } else {
          this.pushClassProperty(classBody, publicProp);
        }
      } else {
        this.unexpected();
      }
    }
    parseClassElementName(member) {
      const {
        type,
        value
      } = this.state;
      if ((type === 130 || type === 131) && member.static && value === "prototype") {
        this.raise(Errors.StaticPrototype, {
          at: this.state.startLoc
        });
      }
      if (type === 136) {
        if (value === "constructor") {
          this.raise(Errors.ConstructorClassPrivateField, {
            at: this.state.startLoc
          });
        }
        const key = this.parsePrivateName();
        member.key = key;
        return key;
      }
      return this.parsePropertyName(member);
    }
    parseClassStaticBlock(classBody, member) {
      var _member$decorators;
      this.scope.enter(64 | 128 | 16);
      const oldLabels = this.state.labels;
      this.state.labels = [];
      this.prodParam.enter(PARAM);
      const body = member.body = [];
      this.parseBlockOrModuleBlockBody(body, undefined, false, 8);
      this.prodParam.exit();
      this.scope.exit();
      this.state.labels = oldLabels;
      classBody.body.push(this.finishNode(member, "StaticBlock"));
      if ((_member$decorators = member.decorators) != null && _member$decorators.length) {
        this.raise(Errors.DecoratorStaticBlock, {
          at: member
        });
      }
    }
    pushClassProperty(classBody, prop) {
      if (!prop.computed && (prop.key.name === "constructor" || prop.key.value === "constructor")) {
        this.raise(Errors.ConstructorClassField, {
          at: prop.key
        });
      }
      classBody.body.push(this.parseClassProperty(prop));
    }
    pushClassPrivateProperty(classBody, prop) {
      const node = this.parseClassPrivateProperty(prop);
      classBody.body.push(node);
      this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), 0, node.key.loc.start);
    }
    pushClassAccessorProperty(classBody, prop, isPrivate) {
      if (!isPrivate && !prop.computed) {
        const key = prop.key;
        if (key.name === "constructor" || key.value === "constructor") {
          this.raise(Errors.ConstructorClassField, {
            at: key
          });
        }
      }
      const node = this.parseClassAccessorProperty(prop);
      classBody.body.push(node);
      if (isPrivate) {
        this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), 0, node.key.loc.start);
      }
    }
    pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper) {
      classBody.body.push(this.parseMethod(method, isGenerator, isAsync, isConstructor, allowsDirectSuper, "ClassMethod", true));
    }
    pushClassPrivateMethod(classBody, method, isGenerator, isAsync) {
      const node = this.parseMethod(method, isGenerator, isAsync, false, false, "ClassPrivateMethod", true);
      classBody.body.push(node);
      const kind = node.kind === "get" ? node.static ? 6 : 2 : node.kind === "set" ? node.static ? 5 : 1 : 0;
      this.declareClassPrivateMethodInScope(node, kind);
    }
    declareClassPrivateMethodInScope(node, kind) {
      this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), kind, node.key.loc.start);
    }
    parsePostMemberNameModifiers(methodOrProp) { }
    parseClassPrivateProperty(node) {
      this.parseInitializer(node);
      this.semicolon();
      return this.finishNode(node, "ClassPrivateProperty");
    }
    parseClassProperty(node) {
      this.parseInitializer(node);
      this.semicolon();
      return this.finishNode(node, "ClassProperty");
    }
    parseClassAccessorProperty(node) {
      this.parseInitializer(node);
      this.semicolon();
      return this.finishNode(node, "ClassAccessorProperty");
    }
    parseInitializer(node) {
      this.scope.enter(64 | 16);
      this.expressionScope.enter(newExpressionScope());
      this.prodParam.enter(PARAM);
      node.value = this.eat(29) ? this.parseMaybeAssignAllowIn() : null;
      this.expressionScope.exit();
      this.prodParam.exit();
      this.scope.exit();
    }
    parseClassId(node, isStatement, optionalId, bindingType = 8331) {
      if (tokenIsIdentifier(this.state.type)) {
        node.id = this.parseIdentifier();
        if (isStatement) {
          this.declareNameFromIdentifier(node.id, bindingType);
        }
      } else {
        if (optionalId || !isStatement) {
          node.id = null;
        } else {
          throw this.raise(Errors.MissingClassName, {
            at: this.state.startLoc
          });
        }
      }
    }
    parseClassSuper(node) {
      node.superClass = this.eat(81) ? this.parseExprSubscripts() : null;
    }
    parseExport(node, decorators) {
      const maybeDefaultIdentifier = this.parseMaybeImportPhase(node, true);
      const hasDefault = this.maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier);
      const parseAfterDefault = !hasDefault || this.eat(12);
      const hasStar = parseAfterDefault && this.eatExportStar(node);
      const hasNamespace = hasStar && this.maybeParseExportNamespaceSpecifier(node);
      const parseAfterNamespace = parseAfterDefault && (!hasNamespace || this.eat(12));
      const isFromRequired = hasDefault || hasStar;
      if (hasStar && !hasNamespace) {
        if (hasDefault) this.unexpected();
        if (decorators) {
          throw this.raise(Errors.UnsupportedDecoratorExport, {
            at: node
          });
        }
        this.parseExportFrom(node, true);
        return this.finishNode(node, "ExportAllDeclaration");
      }
      const hasSpecifiers = this.maybeParseExportNamedSpecifiers(node);
      if (hasDefault && parseAfterDefault && !hasStar && !hasSpecifiers) {
        this.unexpected(null, 5);
      }
      if (hasNamespace && parseAfterNamespace) {
        this.unexpected(null, 97);
      }
      let hasDeclaration;
      if (isFromRequired || hasSpecifiers) {
        hasDeclaration = false;
        if (decorators) {
          throw this.raise(Errors.UnsupportedDecoratorExport, {
            at: node
          });
        }
        this.parseExportFrom(node, isFromRequired);
      } else {
        hasDeclaration = this.maybeParseExportDeclaration(node);
      }
      if (isFromRequired || hasSpecifiers || hasDeclaration) {
        var _node2$declaration;
        const node2 = node;
        this.checkExport(node2, true, false, !!node2.source);
        if (((_node2$declaration = node2.declaration) == null ? void 0 : _node2$declaration.type) === "ClassDeclaration") {
          this.maybeTakeDecorators(decorators, node2.declaration, node2);
        } else if (decorators) {
          throw this.raise(Errors.UnsupportedDecoratorExport, {
            at: node
          });
        }
        return this.finishNode(node2, "ExportNamedDeclaration");
      }
      if (this.eat(65)) {
        const node2 = node;
        const decl = this.parseExportDefaultExpression();
        node2.declaration = decl;
        if (decl.type === "ClassDeclaration") {
          this.maybeTakeDecorators(decorators, decl, node2);
        } else if (decorators) {
          throw this.raise(Errors.UnsupportedDecoratorExport, {
            at: node
          });
        }
        this.checkExport(node2, true, true);
        return this.finishNode(node2, "ExportDefaultDeclaration");
      }
      this.unexpected(null, 5);
    }
    eatExportStar(node) {
      return this.eat(55);
    }
    maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier) {
      if (maybeDefaultIdentifier || this.isExportDefaultSpecifier()) {
        this.expectPlugin("exportDefaultFrom", maybeDefaultIdentifier == null ? void 0 : maybeDefaultIdentifier.loc.start);
        const id = maybeDefaultIdentifier || this.parseIdentifier(true);
        const specifier = this.startNodeAtNode(id);
        specifier.exported = id;
        node.specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
        return true;
      }
      return false;
    }
    maybeParseExportNamespaceSpecifier(node) {
      if (this.isContextual(93)) {
        if (!node.specifiers) node.specifiers = [];
        const specifier = this.startNodeAt(this.state.lastTokStartLoc);
        this.next();
        specifier.exported = this.parseModuleExportName();
        node.specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
        return true;
      }
      return false;
    }
    maybeParseExportNamedSpecifiers(node) {
      if (this.match(5)) {
        if (!node.specifiers) node.specifiers = [];
        const isTypeExport = node.exportKind === "type";
        node.specifiers.push(...this.parseExportSpecifiers(isTypeExport));
        node.source = null;
        node.declaration = null;
        if (this.hasPlugin("importAssertions")) {
          node.assertions = [];
        }
        return true;
      }
      return false;
    }
    maybeParseExportDeclaration(node) {
      if (this.shouldParseExportDeclaration()) {
        node.specifiers = [];
        node.source = null;
        if (this.hasPlugin("importAssertions")) {
          node.assertions = [];
        }
        node.declaration = this.parseExportDeclaration(node);
        return true;
      }
      return false;
    }
    isAsyncFunction() {
      if (!this.isContextual(95)) return false;
      const next = this.nextTokenInLineStart();
      return this.isUnparsedContextual(next, "function");
    }
    parseExportDefaultExpression() {
      const expr = this.startNode();
      if (this.match(68)) {
        this.next();
        return this.parseFunction(expr, 1 | 4);
      } else if (this.isAsyncFunction()) {
        this.next();
        this.next();
        return this.parseFunction(expr, 1 | 4 | 8);
      }
      if (this.match(80)) {
        return this.parseClass(expr, true, true);
      }
      if (this.match(26)) {
        if (this.hasPlugin("decorators") && this.getPluginOption("decorators", "decoratorsBeforeExport") === true) {
          this.raise(Errors.DecoratorBeforeExport, {
            at: this.state.startLoc
          });
        }
        return this.parseClass(this.maybeTakeDecorators(this.parseDecorators(false), this.startNode()), true, true);
      }
      if (this.match(75) || this.match(74) || this.isLet()) {
        throw this.raise(Errors.UnsupportedDefaultExport, {
          at: this.state.startLoc
        });
      }
      const res = this.parseMaybeAssignAllowIn();
      this.semicolon();
      return res;
    }
    parseExportDeclaration(node) {
      if (this.match(80)) {
        const node = this.parseClass(this.startNode(), true, false);
        return node;
      }
      return this.parseStatementListItem();
    }
    isExportDefaultSpecifier() {
      const {
        type
      } = this.state;
      if (tokenIsIdentifier(type)) {
        if (type === 95 && !this.state.containsEsc || type === 99) {
          return false;
        }
        if ((type === 128 || type === 127) && !this.state.containsEsc) {
          const {
            type: nextType
          } = this.lookahead();
          if (tokenIsIdentifier(nextType) && nextType !== 97 || nextType === 5) {
            this.expectOnePlugin(["flow", "typescript"]);
            return false;
          }
        }
      } else if (!this.match(65)) {
        return false;
      }
      const next = this.nextTokenStart();
      const hasFrom = this.isUnparsedContextual(next, "from");
      if (this.input.charCodeAt(next) === 44 || tokenIsIdentifier(this.state.type) && hasFrom) {
        return true;
      }
      if (this.match(65) && hasFrom) {
        const nextAfterFrom = this.input.charCodeAt(this.nextTokenStartSince(next + 4));
        return nextAfterFrom === 34 || nextAfterFrom === 39;
      }
      return false;
    }
    parseExportFrom(node, expect) {
      if (this.eatContextual(97)) {
        node.source = this.parseImportSource();
        this.checkExport(node);
        this.maybeParseImportAttributes(node);
        this.checkJSONModuleImport(node);
      } else if (expect) {
        this.unexpected();
      }
      this.semicolon();
    }
    shouldParseExportDeclaration() {
      const {
        type
      } = this.state;
      if (type === 26) {
        this.expectOnePlugin(["decorators", "decorators-legacy"]);
        if (this.hasPlugin("decorators")) {
          if (this.getPluginOption("decorators", "decoratorsBeforeExport") === true) {
            this.raise(Errors.DecoratorBeforeExport, {
              at: this.state.startLoc
            });
          }
          return true;
        }
      }
      return type === 74 || type === 75 || type === 68 || type === 80 || this.isLet() || this.isAsyncFunction();
    }
    checkExport(node, checkNames, isDefault, isFrom) {
      if (checkNames) {
        var _node$specifiers;
        if (isDefault) {
          this.checkDuplicateExports(node, "default");
          if (this.hasPlugin("exportDefaultFrom")) {
            var _declaration$extra;
            const declaration = node.declaration;
            if (declaration.type === "Identifier" && declaration.name === "from" && declaration.end - declaration.start === 4 && !((_declaration$extra = declaration.extra) != null && _declaration$extra.parenthesized)) {
              this.raise(Errors.ExportDefaultFromAsIdentifier, {
                at: declaration
              });
            }
          }
        } else if ((_node$specifiers = node.specifiers) != null && _node$specifiers.length) {
          for (const specifier of node.specifiers) {
            const {
              exported
            } = specifier;
            const exportName = exported.type === "Identifier" ? exported.name : exported.value;
            this.checkDuplicateExports(specifier, exportName);
            if (!isFrom && specifier.local) {
              const {
                local
              } = specifier;
              if (local.type !== "Identifier") {
                this.raise(Errors.ExportBindingIsString, {
                  at: specifier,
                  localName: local.value,
                  exportName
                });
              } else {
                this.checkReservedWord(local.name, local.loc.start, true, false);
                this.scope.checkLocalExport(local);
              }
            }
          }
        } else if (node.declaration) {
          if (node.declaration.type === "FunctionDeclaration" || node.declaration.type === "ClassDeclaration") {
            const id = node.declaration.id;
            if (!id) throw new Error("Assertion failure");
            this.checkDuplicateExports(node, id.name);
          } else if (node.declaration.type === "VariableDeclaration") {
            for (const declaration of node.declaration.declarations) {
              this.checkDeclaration(declaration.id);
            }
          }
        }
      }
    }
    checkDeclaration(node) {
      if (node.type === "Identifier") {
        this.checkDuplicateExports(node, node.name);
      } else if (node.type === "ObjectPattern") {
        for (const prop of node.properties) {
          this.checkDeclaration(prop);
        }
      } else if (node.type === "ArrayPattern") {
        for (const elem of node.elements) {
          if (elem) {
            this.checkDeclaration(elem);
          }
        }
      } else if (node.type === "ObjectProperty") {
        this.checkDeclaration(node.value);
      } else if (node.type === "RestElement") {
        this.checkDeclaration(node.argument);
      } else if (node.type === "AssignmentPattern") {
        this.checkDeclaration(node.left);
      }
    }
    checkDuplicateExports(node, exportName) {
      if (this.exportedIdentifiers.has(exportName)) {
        if (exportName === "default") {
          this.raise(Errors.DuplicateDefaultExport, {
            at: node
          });
        } else {
          this.raise(Errors.DuplicateExport, {
            at: node,
            exportName
          });
        }
      }
      this.exportedIdentifiers.add(exportName);
    }
    parseExportSpecifiers(isInTypeExport) {
      const nodes = [];
      let first = true;
      this.expect(5);
      while (!this.eat(8)) {
        if (first) {
          first = false;
        } else {
          this.expect(12);
          if (this.eat(8)) break;
        }
        const isMaybeTypeOnly = this.isContextual(128);
        const isString = this.match(131);
        const node = this.startNode();
        node.local = this.parseModuleExportName();
        nodes.push(this.parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly));
      }
      return nodes;
    }
    parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly) {
      if (this.eatContextual(93)) {
        node.exported = this.parseModuleExportName();
      } else if (isString) {
        node.exported = cloneStringLiteral(node.local);
      } else if (!node.exported) {
        node.exported = cloneIdentifier(node.local);
      }
      return this.finishNode(node, "ExportSpecifier");
    }
    parseModuleExportName() {
      if (this.match(131)) {
        const result = this.parseStringLiteral(this.state.value);
        const surrogate = result.value.match(loneSurrogate);
        if (surrogate) {
          this.raise(Errors.ModuleExportNameHasLoneSurrogate, {
            at: result,
            surrogateCharCode: surrogate[0].charCodeAt(0)
          });
        }
        return result;
      }
      return this.parseIdentifier(true);
    }
    isJSONModuleImport(node) {
      if (node.assertions != null) {
        return node.assertions.some(({
          key,
          value
        }) => {
          return value.value === "json" && (key.type === "Identifier" ? key.name === "type" : key.value === "type");
        });
      }
      return false;
    }
    checkImportReflection(node) {
      if (node.module) {
        var _node$assertions;
        if (node.specifiers.length !== 1 || node.specifiers[0].type !== "ImportDefaultSpecifier") {
          this.raise(Errors.ImportReflectionNotBinding, {
            at: node.specifiers[0].loc.start
          });
        }
        if (((_node$assertions = node.assertions) == null ? void 0 : _node$assertions.length) > 0) {
          this.raise(Errors.ImportReflectionHasAssertion, {
            at: node.specifiers[0].loc.start
          });
        }
      }
    }
    checkJSONModuleImport(node) {
      if (this.isJSONModuleImport(node) && node.type !== "ExportAllDeclaration") {
        const {
          specifiers
        } = node;
        if (specifiers != null) {
          const nonDefaultNamedSpecifier = specifiers.find(specifier => {
            let imported;
            if (specifier.type === "ExportSpecifier") {
              imported = specifier.local;
            } else if (specifier.type === "ImportSpecifier") {
              imported = specifier.imported;
            }
            if (imported !== undefined) {
              return imported.type === "Identifier" ? imported.name !== "default" : imported.value !== "default";
            }
          });
          if (nonDefaultNamedSpecifier !== undefined) {
            this.raise(Errors.ImportJSONBindingNotDefault, {
              at: nonDefaultNamedSpecifier.loc.start
            });
          }
        }
      }
    }
    isPotentialImportPhase(isExport) {
      return !isExport && this.isContextual(125);
    }
    applyImportPhase(node, isExport, phase, loc) {
      if (isExport) {
        return;
      }
      if (phase === "module") {
        this.expectPlugin("importReflection", loc);
        node.module = true;
      } else if (this.hasPlugin("importReflection")) {
        node.module = false;
      }
    }
    parseMaybeImportPhase(node, isExport) {
      if (!this.isPotentialImportPhase(isExport)) {
        this.applyImportPhase(node, isExport, null);
        return null;
      }
      const phaseIdentifier = this.parseIdentifier(true);
      const {
        type
      } = this.state;
      const isImportPhase = tokenIsKeywordOrIdentifier(type) ? type !== 97 || this.lookaheadCharCode() === 102 : type !== 12;
      if (isImportPhase) {
        this.resetPreviousIdentifierLeadingComments(phaseIdentifier);
        this.applyImportPhase(node, isExport, phaseIdentifier.name, phaseIdentifier.loc.start);
        return null;
      } else {
        this.applyImportPhase(node, isExport, null);
        return phaseIdentifier;
      }
    }
    isPrecedingIdImportPhase(phase) {
      const {
        type
      } = this.state;
      return tokenIsIdentifier(type) ? type !== 97 || this.lookaheadCharCode() === 102 : type !== 12;
    }
    parseImport(node) {
      if (this.match(131)) {
        return this.parseImportSourceAndAttributes(node);
      }
      return this.parseImportSpecifiersAndAfter(node, this.parseMaybeImportPhase(node, false));
    }
    parseImportSpecifiersAndAfter(node, maybeDefaultIdentifier) {
      node.specifiers = [];
      const hasDefault = this.maybeParseDefaultImportSpecifier(node, maybeDefaultIdentifier);
      const parseNext = !hasDefault || this.eat(12);
      const hasStar = parseNext && this.maybeParseStarImportSpecifier(node);
      if (parseNext && !hasStar) this.parseNamedImportSpecifiers(node);
      this.expectContextual(97);
      return this.parseImportSourceAndAttributes(node);
    }
    parseImportSourceAndAttributes(node) {
      var _node$specifiers2;
      (_node$specifiers2 = node.specifiers) != null ? _node$specifiers2 : node.specifiers = [];
      node.source = this.parseImportSource();
      this.maybeParseImportAttributes(node);
      this.checkImportReflection(node);
      this.checkJSONModuleImport(node);
      this.semicolon();
      return this.finishNode(node, "ImportDeclaration");
    }
    parseImportSource() {
      if (!this.match(131)) this.unexpected();
      return this.parseExprAtom();
    }
    parseImportSpecifierLocal(node, specifier, type) {
      specifier.local = this.parseIdentifier();
      node.specifiers.push(this.finishImportSpecifier(specifier, type));
    }
    finishImportSpecifier(specifier, type, bindingType = 8201) {
      this.checkLVal(specifier.local, {
        in: {
          type
        },
        binding: bindingType
      });
      return this.finishNode(specifier, type);
    }
    parseImportAttributes() {
      this.expect(5);
      const attrs = [];
      const attrNames = new Set();
      do {
        if (this.match(8)) {
          break;
        }
        const node = this.startNode();
        const keyName = this.state.value;
        if (attrNames.has(keyName)) {
          this.raise(Errors.ModuleAttributesWithDuplicateKeys, {
            at: this.state.startLoc,
            key: keyName
          });
        }
        attrNames.add(keyName);
        if (this.match(131)) {
          node.key = this.parseStringLiteral(keyName);
        } else {
          node.key = this.parseIdentifier(true);
        }
        this.expect(14);
        if (!this.match(131)) {
          throw this.raise(Errors.ModuleAttributeInvalidValue, {
            at: this.state.startLoc
          });
        }
        node.value = this.parseStringLiteral(this.state.value);
        attrs.push(this.finishNode(node, "ImportAttribute"));
      } while (this.eat(12));
      this.expect(8);
      return attrs;
    }
    parseModuleAttributes() {
      const attrs = [];
      const attributes = new Set();
      do {
        const node = this.startNode();
        node.key = this.parseIdentifier(true);
        if (node.key.name !== "type") {
          this.raise(Errors.ModuleAttributeDifferentFromType, {
            at: node.key
          });
        }
        if (attributes.has(node.key.name)) {
          this.raise(Errors.ModuleAttributesWithDuplicateKeys, {
            at: node.key,
            key: node.key.name
          });
        }
        attributes.add(node.key.name);
        this.expect(14);
        if (!this.match(131)) {
          throw this.raise(Errors.ModuleAttributeInvalidValue, {
            at: this.state.startLoc
          });
        }
        node.value = this.parseStringLiteral(this.state.value);
        attrs.push(this.finishNode(node, "ImportAttribute"));
      } while (this.eat(12));
      return attrs;
    }
    maybeParseImportAttributes(node) {
      let attributes;
      let useWith = false;
      if (this.match(76)) {
        if (this.hasPrecedingLineBreak() && this.lookaheadCharCode() === 40) {
          return;
        }
        this.next();
        {
          if (this.hasPlugin("moduleAttributes")) {
            attributes = this.parseModuleAttributes();
          } else {
            this.expectImportAttributesPlugin();
            attributes = this.parseImportAttributes();
          }
        }
        useWith = true;
      } else if (this.isContextual(94) && !this.hasPrecedingLineBreak()) {
        if (this.hasPlugin("importAttributes")) {
          if (this.getPluginOption("importAttributes", "deprecatedAssertSyntax") !== true) {
            this.raise(Errors.ImportAttributesUseAssert, {
              at: this.state.startLoc
            });
          }
          this.addExtra(node, "deprecatedAssertSyntax", true);
        } else {
          this.expectOnePlugin(["importAttributes", "importAssertions"]);
        }
        this.next();
        attributes = this.parseImportAttributes();
      } else if (this.hasPlugin("importAttributes") || this.hasPlugin("importAssertions")) {
        attributes = [];
      } else {
        if (this.hasPlugin("moduleAttributes")) {
          attributes = [];
        } else return;
      }
      if (!useWith && this.hasPlugin("importAssertions")) {
        node.assertions = attributes;
      } else {
        node.attributes = attributes;
      }
    }
    maybeParseDefaultImportSpecifier(node, maybeDefaultIdentifier) {
      if (maybeDefaultIdentifier) {
        const specifier = this.startNodeAtNode(maybeDefaultIdentifier);
        specifier.local = maybeDefaultIdentifier;
        node.specifiers.push(this.finishImportSpecifier(specifier, "ImportDefaultSpecifier"));
        return true;
      } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
        this.parseImportSpecifierLocal(node, this.startNode(), "ImportDefaultSpecifier");
        return true;
      }
      return false;
    }
    maybeParseStarImportSpecifier(node) {
      if (this.match(55)) {
        const specifier = this.startNode();
        this.next();
        this.expectContextual(93);
        this.parseImportSpecifierLocal(node, specifier, "ImportNamespaceSpecifier");
        return true;
      }
      return false;
    }
    parseNamedImportSpecifiers(node) {
      let first = true;
      this.expect(5);
      while (!this.eat(8)) {
        if (first) {
          first = false;
        } else {
          if (this.eat(14)) {
            throw this.raise(Errors.DestructureNamedImport, {
              at: this.state.startLoc
            });
          }
          this.expect(12);
          if (this.eat(8)) break;
        }
        const specifier = this.startNode();
        const importedIsString = this.match(131);
        const isMaybeTypeOnly = this.isContextual(128);
        specifier.imported = this.parseModuleExportName();
        const importSpecifier = this.parseImportSpecifier(specifier, importedIsString, node.importKind === "type" || node.importKind === "typeof", isMaybeTypeOnly, undefined);
        node.specifiers.push(importSpecifier);
      }
    }
    parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly, bindingType) {
      if (this.eatContextual(93)) {
        specifier.local = this.parseIdentifier();
      } else {
        const {
          imported
        } = specifier;
        if (importedIsString) {
          throw this.raise(Errors.ImportBindingIsString, {
            at: specifier,
            importName: imported.value
          });
        }
        this.checkReservedWord(imported.name, specifier.loc.start, true, true);
        if (!specifier.local) {
          specifier.local = cloneIdentifier(imported);
        }
      }
      return this.finishImportSpecifier(specifier, "ImportSpecifier", bindingType);
    }
    isThisParam(param) {
      return param.type === "Identifier" && param.name === "this";
    }
  }

  // @ts-nocheck

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
      console.log(file);
      this.startNode();
      console.log(file);
      debugger
      // Tokenizer
      this.nextToken();
      // file.errors = null;
      // this.parseTopLevel(file, program);
      // file.errors = this.state.errors;
      // return file;
    }
  }

  function getParser(options, input) {
    // 构建解析器实例
    let cls = Parser;
    if (options != null && options.plugins) ;
    return new cls(options, input);
  }

  function parse(input, options) {
    if (options) ; else {
      // 获取解析器
      const parser = getParser(options, input);
      console.log(parser);
      // 使用解析器的parse方法将input转化成ast语法树

      parser.parse();
      // return getParser(options, input).parse();
      // return ast

      return parser
    }
  }

  const babel = Object.create(null);
  // 定义parse
  Object.defineProperty(babel, 'parse', {
    get() {
      return parse
    }
  });

  return babel;

}));
//# sourceMappingURL=bundle.js.map
