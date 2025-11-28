import { describe, test, expect } from '@jest/globals';
import { graph } from '../src/agent/graph.js';

describe('Agent Graph', () => {
  test('should have a compiled graph', () => {
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
    expect(typeof graph.stream).toBe('function');
  });
});

