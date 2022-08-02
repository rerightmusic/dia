import { getAlias_ } from './project';

test('getAlias', () => {
  expect(getAlias_('hello_myname_is', '_')).toBe('hmi');
  expect(getAlias_('hello_myname_', '_')).toBe('hem');
  expect(getAlias_('hello_myname', '_')).toBe('hem');
  expect(getAlias_('hellomyname', '_')).toBe('hel');
  expect(getAlias_('hel', '_')).toBe('hel');
  expect(getAlias_('he', '_')).toBe('he');
});
