'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkText } = require('../src/project-chunks');

test('Java method chunks retain class metadata and cited source calls', () => {
  const source = [
    'package com.shop.orders;',
    'import com.shop.service.OrderService;',
    'import java.util.List;',
    '/** 订单创建接口，调用业务服务。 */',
    '@RestController',
    'public class OrderController {',
    '  private final OrderService orderService;',
    '  // 创建订单，校验后调用服务。',
    '  @PostMapping("/orders")',
    '  public Order createOrder(Order input) {',
    '    return orderService.createOrder(input);',
    '  }',
    '}'
  ].join('\n');
  const chunks = chunkText('src/OrderController.java', source);
  const method = chunks.find(c => c.symbol === 'OrderController#createOrder');
  assert.equal(method.kind, 'method');
  assert.equal(method.type, 'function');
  assert.equal(method.language, 'java');
  assert.equal(method.parentClass, 'OrderController');
  assert.equal(method.method, 'createOrder');
  assert.deepEqual(method.methods, ['createOrder']);
  assert.equal(method.packageName, 'com.shop.orders');
  assert.deepEqual(method.imports, ['com.shop.service.OrderService', 'java.util.List']);
  assert.deepEqual(method.fieldTypes, { orderService: 'OrderService' });
  assert.deepEqual(method.localTypes, { input: 'Order' });
  assert.deepEqual(method.calls, [{ receiver: 'orderService', method: 'createOrder', line: 11 }]);
  assert.equal(method.description, '创建订单，校验后调用服务。');
  assert.equal(method.descriptionLine, 8);
  assert.equal(method.declarationLine, 10);
  assert.equal(method.startLine, 8);
  assert.equal(method.endLine, 12);
  assert.ok(method.text.includes('@PostMapping("/orders")'));
  assert.equal(method.role, 'controller');
  assert.equal(method.importance, 'high');
  assert.ok(method.interviewTopics.includes('architecture'));
  assert.ok(chunks.every(c => c.metadataSchemaVersion === 3));
  assert.ok(chunks.every(c => !Object.hasOwn(c, 'projectId')), 'importer retains project identity ownership');
  const header = chunks.find(c => c.kind === 'context' && c.text.includes('private final'));
  assert.equal(header.parentClass, 'OrderController');
  assert.equal(header.type, 'class');
  assert.equal(header.description, '订单创建接口，调用业务服务。');
});

test('Java interface declarations have methods and inheritance evidence without invented implementations', () => {
  const source = [
    'package com.shop.orders;',
    'import org.springframework.data.jpa.repository.JpaRepository;',
    'public interface OrderRepository',
    '    extends JpaRepository<Order, Long>, AuditedRepository<Order> {',
    '  /** 根据业务号查订单。 */',
    '  Order findByNumber(String number);',
    '  default boolean exists(String number) {',
    '    return this.findByNumber(number) != null;',
    '  }',
    '}'
  ].join('\n');
  const chunks = chunkText('OrderRepository.java', source);
  const declaration = chunks.find(c => c.symbol === 'OrderRepository#findByNumber');
  assert.equal(declaration.declarationOnly, true);
  assert.equal(declaration.method, 'findByNumber');
  assert.deepEqual(declaration.methods, ['findByNumber', 'exists']);
  assert.deepEqual(declaration.extends, ['JpaRepository', 'AuditedRepository']);
  assert.equal(declaration.description, '根据业务号查订单。');
  assert.equal(declaration.startLine, 5);
  assert.equal(declaration.declarationLine, 6);
  assert.deepEqual(declaration.calls, []);
  assert.equal(declaration.role, 'repository');
  assert.equal(chunks.some(c => c.method === 'save'), false, 'inherited external methods are not local implementations');
  assert.deepEqual(chunks.find(c => c.method === 'exists').calls, [{ receiver: 'this', method: 'findByNumber', line: 8 }]);
});

test('Java class declarations retain extends/implements and fields without methods', () => {
  const chunks = chunkText('src/Order.java', [
    'public class Order extends BaseOrder',
    '    implements Serializable, Comparable<Order> {',
    '  private String number;',
    '  private java.util.List<Item> items;',
    '}'
  ].join('\n'));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].kind, 'class');
  assert.equal(chunks[0].type, 'class');
  assert.deepEqual(chunks[0].fieldTypes, { number: 'String', items: 'java.util.List<Item>' });
  assert.deepEqual(chunks[0].extends, ['BaseOrder']);
  assert.deepEqual(chunks[0].implements, ['Serializable', 'Comparable']);
});

test('Java field metadata belongs to each class and excludes method locals', () => {
  const chunks = chunkText('Components.java', [
    'class FirstService {',
    '  private FirstRepository repository;',
    '  void run() {',
    '    OtherRepository local = null;',
    '    repository.save(local);',
    '  }',
    '}',
    'class SecondService {',
    '  private SecondRepository repository;',
    '  void run() {',
    '    repository.save(null);',
    '  }',
    '}'
  ].join('\n'));
  assert.deepEqual(chunks.find(c => c.symbol === 'FirstService#run').fieldTypes, { repository: 'FirstRepository' });
  assert.deepEqual(chunks.find(c => c.symbol === 'SecondService#run').fieldTypes, { repository: 'SecondRepository' });
  for (const c of chunks.filter(c => c.parentClass === 'FirstService')) assert.equal(c.fieldTypes.repository, 'FirstRepository');
  for (const c of chunks.filter(c => c.parentClass === 'SecondService')) assert.equal(c.fieldTypes.repository, 'SecondRepository');
});

test('comment/string braces and fake calls do not create symbols or relations', () => {
  const source = [
    'class OrderService {',
    '  private OrderRepository repository;',
    '  public void save() {',
    '    // ghostRepository.deleteAll(); } public void fake() {',
    '    /* fake.run(); { } */',
    '    String json = "{ ghost.call() }";',
    '    char bracket = \'}\';',
    '    String escaped = "\\\" ignored.fake()";',
    '    repository.save(json);',
    '  }',
    '}'
  ].join('\n');
  const chunks = chunkText('OrderService.java', source);
  const method = chunks.find(c => c.method === 'save');
  assert.equal(method.endLine, 10);
  assert.deepEqual(method.calls, [{ receiver: 'repository', method: 'save', line: 9 }]);
  assert.deepEqual(method.methods, ['save']);
});

test('field receiver shadows and explicit this are marked separately', () => {
  const chunks = chunkText('OrderService.java', [
    'class OrderService {',
    '  private OrderRepository repository;',
    '  void save(OtherRepository repository) {',
    '    repository.save(null);',
    '    this.repository.save(null);',
    '    holder.repository.save(null);',
    '  }',
    '}'
  ].join('\n'));
  const method = chunks.find(c => c.method === 'save');
  assert.deepEqual(method.localTypes, { repository: 'OtherRepository' });
  assert.deepEqual(method.calls, [
    { receiver: 'repository', method: 'save', line: 4, shadowed: true },
    { receiver: 'repository', method: 'save', line: 5, explicitThis: true }
  ]);
});

test('multiline annotations and attached comments stay with the method', () => {
  const chunks = chunkText('OrderController.java', [
    'class OrderController {',
    '  /**',
    '   * 查询订单详情。',
    '   */',
    '  @RequestMapping(',
    '      value = "/orders",',
    '      method = RequestMethod.GET',
    '  )',
    '  public Order getOrder(',
    '      String number) {',
    '    return service.find(number);',
    '  }',
    '}'
  ].join('\n'));
  const method = chunks.find(c => c.method === 'getOrder');
  assert.equal(method.startLine, 2);
  assert.equal(method.declarationLine, 9);
  assert.equal(method.description, '查询订单详情。');
  assert.ok(method.text.includes('@RequestMapping('));
  assert.deepEqual(method.calls, [{ receiver: 'service', method: 'find', line: 11 }]);
});

test('oversized Java methods split with stable identity and calls only in the matching part', () => {
  const lines = ['class BigService {', '  void execute() {', ...Array.from({ length: 100 }, (_, i) => `    // padding ${i} ${'x'.repeat(70)}`),
    '    repository.save(null);', '  }', '}'];
  const chunks = chunkText('BigService.java', lines.join('\n'));
  const parts = chunks.filter(c => c.method === 'execute');
  assert.ok(parts.length > 2);
  assert.ok(parts.every(c => c.partial && c.text.length <= 2400));
  assert.ok(parts.every(c => c.declarationLine === 2 && c.symbol === 'BigService#execute'));
  assert.equal(parts.reduce((n, c) => n + c.calls.length, 0), 1);
  assert.equal(parts.flatMap(c => c.calls)[0].line, 103);
  for (const part of parts) for (const call of part.calls) assert.ok(call.line >= part.startLine && call.line <= part.endLine);
  assert.ok(parts.at(-1).text.includes('repository.save(null)'));
});

test('a single oversized line keeps its complete tail in fallback chunks', () => {
  const source = 'a'.repeat(11000) + 'END_MARKER';
  const chunks = chunkText('code.unknown', source);
  assert.equal(chunks.map(c => c.text).join(''), source);
  assert.ok(chunks.every(c => c.partial && c.text.length <= 2400));
  assert.ok(chunks.at(-1).text.endsWith('END_MARKER'));
});

test('JavaScript functions, arrows, classes and masked template literals keep existing lexical fallback', () => {
  const chunks = chunkText('src/service.js', [
    'function helper(value) {',
    '  return client.read(value);',
    '}',
    'const arrow = value => {',
    '  return client.write(value);',
    '};',
    'class Runner {',
    '  execute() {',
    '    const fake = `ignored.run() {}`;',
    '    return client.execute();',
    '  }',
    '}'
  ].join('\n'));
  assert.ok(chunks.some(c => c.symbol === 'helper' && c.kind === 'function'));
  assert.ok(chunks.some(c => c.symbol === 'arrow' && c.kind === 'function'));
  const method = chunks.find(c => c.symbol === 'Runner#execute');
  assert.equal(method.parentClass, 'Runner');
  assert.equal(method.method, 'execute');
  assert.deepEqual(method.calls, [{ receiver: 'client', method: 'execute', line: 10 }]);
  assert.ok(chunks.every(c => c.language === 'javascript' && c.imports.length === 0));
});

test('Python indentation and triple strings preserve method identity and real calls', () => {
  const chunks = chunkText('service.py', [
    'class Service:',
    '    async def run(self, value):',
    '        """ignored.call() { }"""',
    '        # ghost.call()',
    '        return self.save(value)',
    '',
    'def helper():',
    '    return client.read()'
  ].join('\n'));
  const method = chunks.find(c => c.symbol === 'Service#run');
  assert.equal(method.kind, 'function');
  assert.equal(method.method, 'run');
  assert.equal(method.parentClass, 'Service');
  assert.deepEqual(method.methods, ['run']);
  assert.deepEqual(method.calls, [{ receiver: 'self', method: 'save', line: 5 }]);
  assert.ok(chunks.some(c => c.symbol === 'helper' && c.parentClass === ''));
});

test('Go receiver functions retain source ranges without inventing Java metadata', () => {
  const chunks = chunkText('service.go', [
    'package service',
    'func (s *Service) Save(value Order) {',
    '  s.repository.Save(value)',
    '}'
  ].join('\n'));
  const method = chunks.find(c => c.symbol === 'Save');
  assert.equal(method.language, 'go');
  assert.equal(method.kind, 'function');
  assert.equal(method.startLine, 2);
  assert.deepEqual(method.imports, []);
  assert.deepEqual(method.fieldTypes, {});
});

test('documents/config/unsupported syntax keep source content and metadata defaults', () => {
  const md = chunkText('README.md', '# Overview\nProject overview\n## Database\nPostgreSQL transaction');
  assert.equal(md.length, 2);
  assert.ok(md.every(c => c.kind === 'section' && c.type === 'document' && c.role === 'document'));
  assert.ok(md.every(c => c.importance === 'high'));
  assert.ok(md[1].interviewTopics.includes('database'));
  const config = chunkText('src/application.yml', 'spring:\n  datasource:\n    url: jdbc:mysql:localhost');
  assert.equal(config[0].role, 'config');
  const unknown = 'fun save() { repository.save() }';
  const fallback = chunkText('Service.kt', unknown);
  assert.equal(fallback[0].language, 'text');
  assert.equal(fallback[0].text, unknown);
  assert.deepEqual(fallback[0].calls, []);
  assert.deepEqual(fallback[0].fieldTypes, {});
});

test('test and generated source importance is low without changing source roles', () => {
  const chunks = chunkText('test/OrderServiceTest.java', 'class OrderServiceTest {\n  void run() {}\n}');
  assert.ok(chunks.every(c => c.importance === 'low'));
  assert.ok(chunks.every(c => c.metadataSchemaVersion === 3));
});
