/**
 * 1.new.target 是 ECMAScript 2015 (ES6) 中引入的一个元属性（meta property）
 * 2.当使用 new 关键字调用构造函数创建对象时，new.target 将指向被调用的构造函数
 * 3.当被直接调用时则是undefined
 */
class Parent {
  constructor() {
    console.log(new.target); // 输出 Child
  }
}

class Child extends Parent {
  constructor() {
    super(); // 调用父类的构造函数
  }
}

const child = new Child(); // 创建 Child 实例


// 由于class构造函数必须使用new调用，使用function构造函数
function Test() {
  console.log(new.target)
}

new Test() // Test
Test() // undefined