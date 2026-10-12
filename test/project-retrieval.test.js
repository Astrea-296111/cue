'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkText } = require('../src/project-chunks');
const { ProjectSearch } = require('../src/project-search');
const { buildProjectCodeRelations, expandProjectCodeQuery, expandProjectCodeRelations } = require('../src/project-code-relations');

function javaFiles(projectId = 'shop', extras = {}) {
  const files = {
    'src/OrderController.java': `package shop;
import shop.OrderService;
@RestController
public class OrderController {
  private final OrderService orderService;
  @PostMapping("/orders")
  public Order createOrder(CreateOrderRequest request) {
    return orderService.createOrder(request);
  }
}`,
    'src/OrderService.java': `package shop;
import shop.OrderRepository;
@Service
public class OrderService {
  private final OrderRepository orderRepository;
  public Order createOrder(CreateOrderRequest request) {
    return orderRepository.save(new Order(request));
  }
}`,
    'src/OrderRepository.java': `package shop;
public interface OrderRepository extends JpaRepository<Order, Long> {
  Optional<Order> findByOrderNo(String orderNo);
}`,
    ...extras
  };
  return Object.entries(files).flatMap(([file, text]) => chunkText(file, text).map(chunk => ({ ...chunk, projectId })));
}
function seed(chunk) { return { chunk, score: 20, confidence: 1, coverage: 1 }; }

test('source-backed Chinese business mapping plus real receiver calls finds Controller, Service and Repository', () => {
  const chunks = javaFiles('shop', { 'README.md': '# 创建订单\n\n订单创建流程入口：OrderController#createOrder。' });
  const graph = buildProjectCodeRelations(chunks);
  const mapped = expandProjectCodeQuery('订单创建流程在哪里实现？', graph, { scopes: ['@project:shop'] });
  assert.match(mapped.query, /OrderController#createOrder/);
  assert.equal(mapped.mappings[0].sourcePath, 'README.md');
  const ranked = ProjectSearch.build(chunks).rank(mapped.query, ['@project:shop']);
  const controller = ranked.rows.find(row => row.chunk.symbol === 'OrderController#createOrder');
  assert.ok(controller);
  const expanded = expandProjectCodeRelations([controller], graph, { scopes: ['@project:shop'] });
  assert.ok(expanded.some(row => row.chunk.symbol === 'OrderService#createOrder'));
  const repo = expanded.find(row => row.chunk.parentClass === 'OrderRepository');
  assert.ok(repo);
  assert.equal(repo.relation.status, 'resolved');
  assert.equal(repo.relation.declarationOnly, true);
  assert.equal(repo.relation.inherited, true);
  assert.equal(repo.relation.sourcePath, 'src/OrderService.java');
  assert.equal(repo.relation.method, 'save');
  assert.match(repo.chunk.text, /interface OrderRepository extends JpaRepository/);
  assert.doesNotMatch(repo.chunk.text, /save\s*\(/, 'framework implementation is not invented');
});

test('a method source comment can map business terms without a README or translation service', () => {
  const chunks = javaFiles('shop', { 'src/OrderController.java': `package shop;
import shop.OrderService;
public class OrderController {
  private OrderService orderService;
  /** 订单创建入口，保存新订单。 */
  public Order createOrder(Request request) {
    return orderService.createOrder(request);
  }
}` });
  const graph = buildProjectCodeRelations(chunks);
  const mapped = expandProjectCodeQuery('订单创建在哪里实现？', graph, { scopes: ['@project:shop'] });
  assert.match(mapped.query, /OrderController#createOrder/);
  assert.ok(mapped.mappings.some(mapping => mapping.sourcePath === 'src/OrderController.java'));
});

test('unknown Chinese business terms do not manufacture mappings on English-only code', () => {
  const graph = buildProjectCodeRelations(javaFiles());
  for (const query of ['订单创建流程在哪里实现？', '发票折让流程在哪里实现？']) {
    const mapped = expandProjectCodeQuery(query, graph, { scopes: ['@project:shop'] });
    assert.equal(mapped.query, query);
    assert.deepEqual(mapped.mappings, []);
  }
});

test('business mapping and relation expansion never borrow source evidence from another scope', () => {
  const chunks = [...javaFiles('shop'), ...javaFiles('other', { 'README.md': '# 订单\n订单创建：OrderController#createOrder。' })];
  const graph = buildProjectCodeRelations(chunks);
  assert.equal(expandProjectCodeQuery('订单创建在哪里实现？', graph, { scopes: ['@project:shop'] }).mappings.length, 0);
  const controller = chunks.find(chunk => chunk.projectId === 'shop' && chunk.symbol === 'OrderController#createOrder');
  const out = expandProjectCodeRelations([seed(controller)], graph, { scopes: ['@project:shop'] });
  assert.ok(out.length >= 3);
  assert.ok(out.every(row => row.chunk.projectId === 'shop'));
  assert.deepEqual(expandProjectCodeRelations([seed(controller)], graph, { scopes: ['@project:other'] }), []);
});

test('similar class names without imports are ambiguous; explicit import supplies a verifiable target', () => {
  const extra = {
    'src/other/OrderService.java': `package other;
public class OrderService {
  public Order createOrder(Request request) { return null; }
}`,
    'src/OrderController.java': `package shop;
public class OrderController {
  private OrderService orderService;
  public Order createOrder(Request request) {
    return orderService.createOrder(request);
  }
}`
  };
  let chunks = javaFiles('shop', extra);
  let graph = buildProjectCodeRelations(chunks);
  let controller = chunks.find(chunk => chunk.symbol === 'OrderController#createOrder');
  assert.ok(graph.diagnostics.some(edge => edge.fromSymbol === controller.symbol && edge.status === 'ambiguous'));
  assert.equal(expandProjectCodeRelations([seed(controller)], graph, { scopes: ['@project:shop'] }).length, 1);
  extra['src/OrderController.java'] = extra['src/OrderController.java'].replace('package shop;', 'package shop;\nimport shop.OrderService;');
  chunks = javaFiles('shop', extra); graph = buildProjectCodeRelations(chunks);
  controller = chunks.find(chunk => chunk.symbol === 'OrderController#createOrder');
  const expanded = expandProjectCodeRelations([seed(controller)], graph, { scopes: ['@project:shop'] });
  assert.ok(expanded.some(row => row.chunk.path === 'src/OrderService.java'));
  assert.ok(expanded.every(row => row.chunk.path !== 'src/other/OrderService.java'));
});

test('field-name shadowing cannot become a fabricated field call; explicit this remains source-backed', () => {
  const chunks = javaFiles('shop', { 'src/OrderController.java': `package shop;
import shop.OrderService;
public class OrderController {
  private OrderService orderService;
  public Order shadow(Object orderService) {
    return orderService.createOrder(null);
  }
  public Order explicit(Object orderService) {
    return this.orderService.createOrder(null);
  }
}` });
  const graph = buildProjectCodeRelations(chunks);
  const shadow = chunks.find(chunk => chunk.method === 'shadow');
  const explicit = chunks.find(chunk => chunk.method === 'explicit');
  assert.ok(shadow && explicit);
  assert.equal(expandProjectCodeRelations([seed(shadow)], graph, { scopes: ['@project:shop'] }).length, 1);
  assert.ok(graph.diagnostics.some(edge => edge.fromSymbol === shadow.symbol && edge.reason === 'receiver-shadowed'));
  assert.ok(expandProjectCodeRelations([seed(explicit)], graph, { scopes: ['@project:shop'] }).some(row => row.chunk.symbol === 'OrderService#createOrder'));
});

test('overloads remain ambiguous; splitting a long method does not create an overload', () => {
  const chunks = javaFiles('shop', { 'src/OrderService.java': `package shop;
public class OrderService {
  public Order createOrder(Request request) { return null; }
  public Order createOrder(String request) { return null; }
}` });
  const graph = buildProjectCodeRelations(chunks);
  const controller = chunks.find(chunk => chunk.symbol === 'OrderController#createOrder');
  assert.ok(graph.diagnostics.some(edge => edge.reason === 'overload-unresolved'));
  assert.equal(expandProjectCodeRelations([seed(controller)], graph, { scopes: ['@project:shop'] }).length, 1);
  const long = javaFiles('shop', { 'src/OrderService.java': `package shop;
public class OrderService {
  public Order createOrder(Request request) {
${'    work(); // lengthy evidence\n'.repeat(250)}
    return null;
  }
}` });
  const longGraph = buildProjectCodeRelations(long);
  const longController = long.find(chunk => chunk.symbol === 'OrderController#createOrder');
  assert.ok(expandProjectCodeRelations([seed(longController)], longGraph, { scopes: ['@project:shop'] }).some(row => row.chunk.symbol === 'OrderService#createOrder'));
  assert.equal(longGraph.diagnostics.some(edge => edge.fromSymbol === longController.symbol && edge.reason === 'overload-unresolved'), false);
});

test('legacy chunks stay searchable while missing call metadata remains absent', () => {
  const chunks = [{ path: 'Shop/OrderService.java', startLine: 1, endLine: 2, text: 'createOrder saves an order.', symbol: 'OrderService#createOrder', kind: 'method' }];
  const graph = buildProjectCodeRelations(chunks);
  const ranked = ProjectSearch.build(chunks).rank('createOrder', ['Shop/']);
  assert.equal(ranked.rows.length, 1);
  assert.equal(expandProjectCodeRelations(ranked.rows, graph, { scopes: ['Shop/'] }).length, 1);
  assert.equal(graph.edges.size, 0);
});

test('separate lexical and hash channels are capped and merged without duplicate source ids', () => {
  const chunks = Array.from({ length: 180 }, (_, i) => ({ projectId: 'shop', path: `src/Order${i}.java`,
    startLine: 1, endLine: 2, text: 'order createOrder cache consistency retry 缓存 一致性' }));
  const ranked = ProjectSearch.build(chunks).rank('createOrder 缓存一致性', ['@project:shop']);
  assert.ok(ranked.lexicalCandidates <= 50);
  assert.ok(ranked.denseCandidates <= 50);
  assert.ok(ranked.rows.length <= 60);
  assert.equal(new Set(ranked.rows.map(row => row.id)).size, ranked.rows.length);
  assert.equal(ranked.vectorStatus, 'disabled');
  assert.equal(ranked.rerankerStatus, 'disabled');
});

test('optional synchronous vector and rerank contracts receive only scoped candidates and cannot return foreign evidence', () => {
  const chunks = [
    { projectId: 'shop', path: 'Shop/A.java', startLine: 1, endLine: 1, text: 'cache redis consistency' },
    { projectId: 'shop', path: 'Shop/B.java', startLine: 1, endLine: 1, text: 'cache retry redis' },
    { projectId: 'other', path: 'Other/secret.java', startLine: 1, endLine: 1, text: 'FOREIGN cache redis' }
  ];
  let vectorCalls = 0, rerankCalls = 0;
  const search = ProjectSearch.build(chunks, {
    vectorProvider: { ready: true, modelVersion: 'fixture-v1', search(params) {
      vectorCalls++; assert.deepEqual(params.scopes, ['@project:shop']);
      assert.ok(params.candidates.every(row => row.chunk.projectId === 'shop'));
      return [{ id: 2, score: 1 }, { id: 1, score: 0.9 }, { id: -1, score: 1 }];
    } },
    reranker: { ready: true, modelVersion: 'fixture-v1', rerank(params) {
      rerankCalls++; assert.ok(params.candidates.every(row => row.chunk.projectId === 'shop'));
      return [{ id: 2, score: 100 }, { id: 1, score: 99 }];
    } }
  });
  const ranked = search.rank('cache redis', ['@project:shop']);
  assert.equal(vectorCalls, 1); assert.equal(rerankCalls, 1);
  assert.equal(ranked.rows[0].id, 1);
  assert.ok(ranked.rows.every(row => row.chunk.projectId === 'shop'));
  assert.equal(ranked.vectorCandidates, 1);
  assert.equal(search.rank('cache redis', ['@project:shop']).cacheHit, true);
  assert.equal(vectorCalls, 1); assert.equal(rerankCalls, 1);
});

test('disabled, failing and async providers preserve synchronous local retrieval without waiting', () => {
  const chunks = javaFiles();
  let called = false;
  const asyncProvider = { ready: true, async search() { called = true; throw new Error('no remote calls'); } };
  let ranked = ProjectSearch.build(chunks, { vectorProvider: asyncProvider }).rank('createOrder', ['@project:shop']);
  assert.equal(called, false); assert.equal(ranked.vectorStatus, 'async-unsupported'); assert.ok(ranked.rows.length);
  ranked = ProjectSearch.build(chunks, { vectorProvider: { ready: true, search() { throw new Error('fixture unavailable'); } },
    reranker: { ready: true, rerank() { return Promise.reject(new Error('async unsupported')); } }
  }).rank('createOrder', ['@project:shop']);
  assert.equal(ranked.vectorStatus, 'unavailable'); assert.equal(ranked.rerankerStatus, 'async-unsupported'); assert.ok(ranked.rows.length);
  const unscoped = ProjectSearch.build(chunks, { vectorProvider: { ready: true, search() { called = true; return []; } } }).rank('createOrder');
  assert.equal(called, false); assert.equal(unscoped.vectorStatus, 'unscoped-disabled');
});

test('provider version and scope participate in ranking cache identity', () => {
  const chunks = [...javaFiles('shop'), ...javaFiles('other')];
  let calls = 0;
  const provider = { ready: true, modelVersion: 'v1', search() { calls++; return []; } };
  const search = ProjectSearch.build(chunks, { vectorProvider: provider });
  search.rank('createOrder', ['@project:shop']);
  assert.equal(search.rank('createOrder', ['@project:shop']).cacheHit, true);
  provider.modelVersion = 'v2';
  assert.equal(search.rank('createOrder', ['@project:shop']).cacheHit, false);
  assert.equal(search.rank('createOrder', ['@project:other']).cacheHit, false);
  assert.equal(calls, 3);
});
