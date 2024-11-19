module.exports = function UncacheablePassthroughLoader(source) {
  this.cacheable(false);
  return source;
};
