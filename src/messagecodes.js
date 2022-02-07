module.exports = {
  // stream related message types (carries a payload)
  stdin: 0,
  stdout: 1,
  stderr: 2,
  //special message type (carries a payload)
  resize: 50,
  // data-flow related message types (carries no payload)
  resume: 100, // Process is now ready to receive data
  pause: 101, // Process is processing current data, don't send more right now
  end: 102, //Indicates end of stream
  // resolution related message types
  stopped: 200, // Process exited, payload is single byte exit code
  shutdown: 201, // Server shut down
  error: 202, // Some internal error occurred, expect undefined behaviour
  //may carry utf8 payload regarding error reason
};
