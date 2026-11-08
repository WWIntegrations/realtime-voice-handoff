import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDemo, summarize } from '../examples/demo.js';

const root = new URL('..', import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, ['examples/demo.js', ...args], { cwd: root, encoding: 'utf8' });

test('default output is a short human summary and can be repeated', () => {
    for (let i = 0; i < 2; i++) {
        const result = run();
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /demo: PASS \(5 of 5 checks\)/);
        assert.ok(result.stdout.split('\n').length < 15);
        assert.ok(result.stdout.length < 1500);
        assert.doesNotMatch(result.stdout, /"steps"/);
    }
});

test('--json prints the recorded trace byte for byte', () => {
    const result = run('--json');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, readFileSync(new URL('../examples/demo.json', import.meta.url), 'utf8'));
});

test('shipped input example runs through the real protocol', () => {
    const result = run('--input', 'examples/handoff.json');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /reason user_requested, 2 message\(s\), topic billing/);
});

test('invalid or unreadable input exits 2 with a readable message and no echo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-cli-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"reason":"SECRET-MARKER"}');
    for (const args of [['--input', bad], ['--input', join(dir, 'missing.json')], ['--nope']]) {
        const result = run(...args);
        assert.equal(result.status, 2);
        assert.equal(result.stdout, '');
        assert.ok(result.stderr.length > 10);
        assert.doesNotMatch(result.stderr, /SECRET-MARKER/);
        assert.doesNotMatch(result.stderr, /at .*\.js:\d+/);
    }
});

test('summary reports FAIL when the trace violates the contract', async () => {
    const trace = await runDemo();
    trace.steps.find(step => step.id === 'snapshot-validated').state.played.specialist = true;
    const { passed, text } = summarize(trace);
    assert.equal(passed, false);
    assert.match(text, /FAIL/);
});
