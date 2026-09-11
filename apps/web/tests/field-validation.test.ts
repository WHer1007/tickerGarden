import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldError } from '../src/ui/fieldValidation.ts';

const e = (raw: string, rule: Parameters<typeof fieldError>[1]) => fieldError(raw, rule);
test('required names and tickers', () => {
  assert.equal(e('   ', {kind: 'name', required: true}), 'This field is required.');
  assert.equal(e('a'.repeat(65), {kind: 'name'}), 'Use at most 64 characters.');
  assert.equal(e('bad-symbol', {kind: 'ticker'}), 'Use 1–16 letters A–Z or digits 0–9.');
  assert.equal(e('A'.repeat(17), {kind: 'ticker'}), 'Use 1–16 letters A–Z or digits 0–9.');
  assert.equal(e('ABC123', {kind: 'ticker'}), '');
});
test('websites and X handles reject credentials, javascript, wrong hosts and query strings', () => {
  assert.equal(e('https://x.com/alice_1', {kind: 'social'}), '');
  assert.equal(e('@alice_1', {kind: 'social'}), '');
  for (const value of ['http://x.com/alice', 'https://evil.com/alice', 'https://alice:pw@x.com/alice', 'javascript:alert(1)', 'https://x.com/alice?next=evil', 'https://twitter.com/a#x']) assert.notEqual(e(value, {kind: 'social'}), '');
  assert.equal(e('http://example.com/path', {kind: 'website'}), '');
  assert.equal(e('https://example.com', {kind: 'website'}), '');
  for (const value of ['ftp://example.com', 'javascript:alert(1)', 'https://u:p@example.com']) assert.notEqual(e(value, {kind: 'website'}), '');
});
test('addresses and bytes32 enforce hex length and zero policy', () => {
  const address = '0x' + 'a'.repeat(40), hash = '0x' + 'b'.repeat(64);
  assert.equal(e(address, {kind: 'address'}), ''); assert.notEqual(e('0x' + 'a'.repeat(39), {kind: 'address'}), '');
  assert.notEqual(e('0x' + 'g'.repeat(40), {kind: 'address'}), ''); assert.notEqual(e('0x' + '0'.repeat(40), {kind: 'address'}), '');
  assert.equal(e('0x' + '0'.repeat(40), {kind: 'address', allowZero: true}), '');
  assert.equal(e(hash, {kind: 'bytes32'}), ''); assert.notEqual(e(address, {kind: 'bytes32'}), '');
});
test('amounts reject signs, exponents, commas, excess precision and uint256 overflow', () => {
  for (const value of ['-1', '+1', '1e3', '1,000']) assert.notEqual(e(value, {kind: 'amount', decimals: 18}), '');
  assert.notEqual(e('1.1234567', {kind: 'amount', decimals: 6}), '');
  assert.equal(e('1.123456', {kind: 'amount', decimals: 6}), '');
  assert.notEqual(e('1.1234567890123456789', {kind: 'amount', decimals: 18}), '');
  assert.equal(e('0', {kind: 'amount', allowZero: true}), '');
  assert.notEqual(e((1n << 256n).toString(), {kind: 'amount', decimals: 0}), '');
});
test('integer, slippage and creator tax boundaries', () => {
  assert.equal(e('0', {kind: 'integer', allowZero: true, max: 4294967295}), '');
  assert.equal(e('4294967295', {kind: 'integer', max: 4294967295}), '');
  assert.notEqual(e('4294967296', {kind: 'integer', max: 4294967295}), '');
  assert.notEqual(e('-1', {kind: 'integer'}), '');
  assert.equal(e('5000', {kind: 'integer', allowZero: true, max: 5000}), '');
  assert.notEqual(e('5001', {kind: 'integer', allowZero: true, max: 5000}), '');
  assert.equal(e('5.00', {kind: 'tax'}), ''); assert.notEqual(e('5.01', {kind: 'tax'}), ''); assert.notEqual(e('6', {kind: 'tax'}), '');
});

test('description accepts 300 characters and rejects longer restored values',()=>{
  assert.equal(e('',{kind:'description'}),'');
  assert.equal(e('文'.repeat(300),{kind:'description'}),'');
  assert.equal(e('文'.repeat(301),{kind:'description'}),'Use at most 300 characters.');
});
