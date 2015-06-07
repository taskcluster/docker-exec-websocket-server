module.exports = {
  // stream related messages types (carries a payload)
  stdin: 0,
  stdout: 1,
  stderr: 2,
  // data-flow related message types (carries no payload)
  resume: 100, // Process is now ready to receive data
  pause: 101, // Process is processing current data, don't send more right now
  // resolution related message types
  stopped: 200, // Process exited, payload is single byte exit code
  error: 201 // Some internal error occurred sorry, expect undefined behaviour
};
