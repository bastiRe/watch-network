(function() {
  var EventEmitter, Logger, WatchNetwork, _, async, defaultOptions, fs, gutil, minimatch, net, path, runSequence, util,
    bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty,
    slice = [].slice;

  async = require('async');

  net = require('net');

  path = require('path');

  _ = require('lodash');

  minimatch = require('minimatch');

  runSequence = require('run-sequence');

  fs = require('fs');

  gutil = require('gulp-util');

  util = require('util');

  EventEmitter = require('events').EventEmitter;

  defaultOptions = {
    host: 'localhost',
    port: 4000,
    rootFile: '.root',
    fileSyncBufferTime: 50,
    flushDeferredTasks: true,
    gulp: null,
    configs: [],
    logLevel: 'info'
  };

  WatchNetwork = (function(superClass) {
    extend(WatchNetwork, superClass);

    function WatchNetwork(_options) {
      this._options = _options != null ? _options : {};
      this._handleIncomingDataFromListen = bind(this._handleIncomingDataFromListen, this);
      this._touchLocalRootFileAndWait = bind(this._touchLocalRootFileAndWait, this);
      _.defaults(this._options, defaultOptions);
      if (this._options.gulp) {
        runSequence = runSequence.use(this._options.gulp);
      }
      this._rootFileRegExp = new RegExp(this._options.rootFile + "$");
      this._localRootFilePath = path.join(process.cwd(), this._options.rootFile);
      this._tasks = {};
      this._executingTasks = false;
      this._deferredTaskMatches = [];
      this._waitingOnRootFileChange = true;
      this._waitingOnRootFileChangeRetries = 0;
      this._waitingOnRootFileChangeMaxRetries = 3;
      this._waitingOnRootFileChangeIntervalId = null;
      this._queuingFileChanges = false;
      this._queuedChangedFiles = [];
      this._initialized = false;
      this.lastChangeTime = null;
      this.log = new Logger;
      this.log.setLogLevel(this._options.logLevel);
    }

    WatchNetwork.prototype.initialize = function(callback) {
      if (callback == null) {
        callback = function() {};
      }
      this.log.info("Initializing");
      this.on('initialized', (function(_this) {
        return function() {
          _this.log.info("Initialized");
          return callback();
        };
      })(this));
      this.on('changed', (function(_this) {
        return function() {
          return _this.lastChangeTime = new Date();
        };
      })(this));
      this._executeTasksOnLoad((function(_this) {
        return function() {
          _this.log.info("Connecting to Listen");
          _this._socket = _this._connectToSocket(function() {
            return _this.log.info("Connected to Listen at " + _this._options.host + ":" + _this._options.port);
          });
          _this._socket.on('data', function(buffer) {
            return _this._handleIncomingDataFromListen(buffer.toString());
          });
          _this._socket.on('end', function() {
            return _this.log.info("Connection to Listen lost");
          });
          return process.on('SIGINT', function() {
            _this.stop();
            return process.exit(0);
          });
        };
      })(this));
      return this;
    };

    WatchNetwork.prototype.task = function(taskName, taskFunction) {
      this._tasks[taskName] = taskFunction;
      return this;
    };

    WatchNetwork.prototype.stop = function() {
      this._socket.end();
      this._socket.destroy();
      this.log.info("Disconnected from Listen");
      this.removeAllListeners();
      this.log.debug("Removed all Listeners");
      return this;
    };

    WatchNetwork.prototype._connectToSocket = function(callback) {
      return net.connect({
        port: this._options.port,
        host: this._options.host
      }, (function(_this) {
        return function() {
          var ref;
          callback.apply.apply(callback, arguments);
          return (ref = _this._touchLocalRootFileAndWait).apply.apply(ref, arguments);
        };
      })(this));
    };

    WatchNetwork.prototype._touchLocalRootFileAndWait = function() {
      return true;
    };

    WatchNetwork.prototype._touchLocalRootFile = function() {
      this.log.debug("Touching Local RootFile " + this._localRootFilePath);
      return fs.writeFileSync(this._localRootFilePath);
    };

    WatchNetwork.prototype._handleIncomingDataFromListen = function(data, callback) {
      var files;
      if (callback == null) {
        callback = function() {};
      }
      this.log.debug("Incoming Listen Data: " + data);
      files = this._parseFilesFromListenData(data);
      if (this._waitingOnRootFileChange) {
        this._searchRootFileInChangedFilesAndWait(files, (function(_this) {
          return function() {
            _this._waitingOnRootFileChange = false;
            _this._waitingOnRootFileChangeRetries = 0;
            files = _this._stripRemoteRootPathFromFiles(files);
            return callback();
          };
        })(this));
        return;
      }
      files = this._stripRemoteRootPathFromFiles(files);
      if (this._queuingFileChanges) {
        this._queuedChangedFiles = this._queuedChangedFiles.concat(files);
        return;
      }
      this.log.debug("Waiting for " + this._options.fileSyncBufferTime + "ms on file changes for sync and buffering purposes");
      this._queuedChangedFiles = this._queuedChangedFiles.concat(files);
      return this._queuingFileChanges = setTimeout((function(_this) {
        return function() {
          files = _this._arrayUnique(_this._queuedChangedFiles);
          _this.log.debug("Handling queued File Changes", files);
          _this._queuingFileChanges = false;
          _this.log.info("Changed Files: " + (files.join(', ')));
          _this._executeTasksMatchingChangedFiles(files, function() {
            _this.emit('changed', files);
            return callback();
          });
          return _this._queuedChangedFiles = [];
        };
      })(this), this._options.fileSyncBufferTime);
    };

    WatchNetwork.prototype._searchRootFileInChangedFilesAndWait = function(files, callback) {
      this.log.debug("Got FileChange Events from Listen, searching for the RootFile in '" + files + "'");
      if (this._searchRootFileInChangedFiles(files)) {
        this.log.debug("Successfully detected RootFile and set RemoteRootPath to '" + this._remoteRoothPath + "'!");
        this._removeLocalRootFile();
        this._initialized = true;
        callback();
        return this.emit('initialized', files);
      } else {
        this._removeLocalRootFile();
        return this._touchLocalRootFileAndWait();
      }
    };

    WatchNetwork.prototype._searchRootFileInChangedFiles = function(files) {
      var filename, i, len;
      for (i = 0, len = files.length; i < len; i++) {
        filename = files[i];
        if (this._rootFileRegExp.test(filename)) {
          this._remoteRoothFilePath = filename;
          this._remoteRoothPath = path.dirname(filename);
          return true;
        }
      }
      return false;
    };

    WatchNetwork.prototype._removeLocalRootFile = function() {
      if (fs.existsSync(this._localRootFilePath)) {
        return fs.unlinkSync(this._localRootFilePath);
      }
    };

    WatchNetwork.prototype._parseFilesFromListenData = function(data) {
      var filename, files, i, json, jsonMatch, jsonMatches, len;
      jsonMatches = data.match(/\[[^\[\]]+\]/g);
      files = [];
      for (i = 0, len = jsonMatches.length; i < len; i++) {
        jsonMatch = jsonMatches[i];
        json = JSON.parse(jsonMatch);
        filename = json[2] + "/" + json[3];
        if ((files.indexOf(filename)) === -1) {
          files.push(filename);
        }
      }
      return files;
    };

    WatchNetwork.prototype._stripRemoteRootPathFromFiles = function(files) {
      var remoteDirRegExp;
      remoteDirRegExp = new RegExp(this._remoteRoothPath + "/?");
      return files = files.map((function(_this) {
        return function(file) {
          return file.replace(remoteDirRegExp, '');
        };
      })(this));
    };

    WatchNetwork.prototype._executeTasksOnLoad = function(callback) {
      if (callback == null) {
        callback = function() {};
      }
      this.log.debug("Executing Tasks with onLoad flag");
      return async.eachSeries(this._options.configs, (function(_this) {
        return function(config, done) {
          if (config.onLoad) {
            return _this._executeTasks(config.tasks, '', done);
          } else {
            return done();
          }
        };
      })(this), callback);
    };

    WatchNetwork.prototype._executeTasksMatchingChangedFiles = function(files, callback) {
      var filename, i, j, len, len1, match, matches, tasks;
      if (callback == null) {
        callback = function() {};
      }
      if (this._executingTasks) {
        tasks = [];
        for (i = 0, len = files.length; i < len; i++) {
          filename = files[i];
          matches = this._matchFilenameAgainstConfigsPatterns(filename);
          this._deferredTaskMatches = this._deferredTaskMatches.concat(matches);
          for (j = 0, len1 = matches.length; j < len1; j++) {
            match = matches[j];
            tasks = tasks.concat(match.tasks);
          }
        }
        if (tasks.length > 0) {
          this.log.info("Deferred Tasks '" + tasks + "'");
        }
        return callback();
      }
      this._executingTasks = true;
      return async.eachSeries(files, (function(_this) {
        return function(filename, done) {
          if (_this._rootFileRegExp.test(filename)) {
            return done();
          }
          matches = _this._matchFilenameAgainstConfigsPatterns(filename);
          if (matches.length <= 0) {
            return done();
          }
          return _this._executeMatchedTasks(matches, done);
        };
      })(this), (function(_this) {
        return function() {
          return _this._executeDeferredTasks(function() {
            _this._executingTasks = false;
            return callback();
          });
        };
      })(this));
    };

    WatchNetwork.prototype._matchFilenameAgainstConfigsPatterns = function(filename) {
      var config, i, j, len, len1, matched, matches, pattern, ref, ref1;
      matches = [];
      ref = this._options.configs;
      for (i = 0, len = ref.length; i < len; i++) {
        config = ref[i];
        if (!config.patterns || !config.tasks) {
          continue;
        }
        if (typeof config.patterns === 'string') {
          config.patterns = [config.patterns];
        }
        matched = false;
        ref1 = config.patterns;
        for (j = 0, len1 = ref1.length; j < len1; j++) {
          pattern = ref1[j];
          if (minimatch(filename, pattern)) {
            matched = true;
          }
        }
        if (!matched) {
          continue;
        }
        this.log.debug("Pattern '" + pattern + "' matched. Queueing tasks '" + config.tasks + "'");
        matches.push({
          filename: filename,
          tasks: config.tasks
        });
      }
      return matches;
    };

    WatchNetwork.prototype._executeMatchedTasks = function(matches, callback) {
      return async.eachSeries(matches, (function(_this) {
        return function(match, done) {
          return _this._executeTasks(match.tasks, match.filename, done);
        };
      })(this), function() {
        return callback();
      });
    };

    WatchNetwork.prototype._executeTasks = function(tasks, changedFile, callback) {
      if (typeof tasks === 'string') {
        tasks = [tasks];
      }
      if (tasks.length === 0) {
        return callback();
      }
      return async.eachSeries(tasks, (function(_this) {
        return function(task, done) {
          if (!_this._tasks[task] || typeof _this._tasks[task] !== 'function') {
            return done();
          }
          _this.log.info("Executing task '" + task + "'");
          return _this._executeTask(task, changedFile, function() {
            _this.log.info("Finished Executing task '" + task + "'");
            return done();
          });
        };
      })(this), (function(_this) {
        return function() {
          if (_this._options.gulp) {
            return _this._executeGulpTasksWithRunSequence(tasks, callback);
          } else {
            return callback();
          }
        };
      })(this));
    };

    WatchNetwork.prototype._executeTask = function(task, changedFile, callback) {
      var taskArgsLength, taskFunction;
      taskFunction = this._tasks[task];
      taskArgsLength = taskFunction.length;
      if (taskArgsLength === 0) {
        this._tasks[task]();
        return callback();
      } else if (taskArgsLength === 2) {
        return this._tasks[task](changedFile, function() {
          return callback();
        });
      }
    };

    WatchNetwork.prototype._executeDeferredTasks = function(callback) {
      if (this._deferredTaskMatches.length <= 0) {
        return callback();
      }
      if (this._options.flushDeferredTasks) {
        this.log.debug("Flushing deferred tasks '" + this._deferredTaskMatches + "'");
        this._deferredTaskMatches = [];
        return callback();
      }
      this.log.info("Executing deferred tasks");
      return this._executeMatchedTasks(this._deferredTaskMatches, '', (function(_this) {
        return function() {
          _this.log.info("Finished deferred tasks");
          _this._deferredTaskMatches = [];
          return callback();
        };
      })(this));
    };

    WatchNetwork.prototype._executeGulpTasksWithRunSequence = function(tasks, callback) {
      this.log.info("Executing gulp-tasks with run-sequence '" + tasks + "'");
      tasks = tasks.filter((function(_this) {
        return function(task) {
          return _this._options.gulp.tasks[task];
        };
      })(this));
      if (tasks.length === 0) {
        return callback();
      }
      return runSequence.apply(null, slice.call(tasks).concat([(function(_this) {
        return function() {
          _this.log.info("Finished Executing gulp-tasks with run-sequence '" + tasks + "'");
          return callback();
        };
      })(this)]));
    };

    WatchNetwork.prototype._arrayUnique = function(a) {
      return a.reduce(function(p, c) {
        if (p.indexOf(c) < 0) {
          p.push(c);
        }
        return p;
      }, []);
    };

    return WatchNetwork;

  })(EventEmitter);

  Logger = (function() {
    function Logger() {}

    Logger.prototype._logLevel = 1;

    Logger.prototype.setLogLevel = function(logLevel) {
      return this._logLevel = (function() {
        switch (logLevel) {
          case 'debug':
            return 0;
          case 'warn':
            return 1;
          case 'info':
            return 2;
          case 'error':
            return 3;
        }
      })();
    };

    Logger.prototype.debug = function() {
      if (this._logLevel > 0) {
        return;
      }
      return gutil.log.apply(gutil, arguments);
    };

    Logger.prototype.warn = function() {
      if (this._logLevel > 1) {
        return;
      }
      return gutil.log.apply(gutil, arguments);
    };

    Logger.prototype.info = function() {
      if (this._logLevel > 2) {
        return;
      }
      return gutil.log.apply(gutil, arguments);
    };

    Logger.prototype.error = function() {
      if (this._logLevel > 3) {
        return;
      }
      return gutil.log.apply(gutil, arguments);
    };

    return Logger;

  })();

  module.exports = function(options) {
    return new WatchNetwork(options);
  };

}).call(this);
