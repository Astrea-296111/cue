'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const oral = require('../src/oral-answer-policy');

test('direct answers and factual uncertainty apply with and without custom style', () => {
  for (const customStyle of [false, true]) {
    const instruction = oral.instruction({ ...oral.plan('能直接释放 License 吗？'), customStyle });
    assert.match(instruction, /首句直接/);
    assert.match(instruction, /无法确认/);
    assert.match(instruction, /不复述问题|不要先复述问题/);
  }
});
