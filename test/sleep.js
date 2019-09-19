/** Return promise that is resolved in `delay` ms */
module.exports = function(delay) {
  return new Promise(function(accept) {
    setTimeout(accept, delay);
  });
};
