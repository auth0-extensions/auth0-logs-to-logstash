module.exports =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/build/";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	var _logTypes;

	function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

	var winston = __webpack_require__(1);
	var async = __webpack_require__(2);
	var moment = __webpack_require__(3);
	var useragent = __webpack_require__(4);
	var express = __webpack_require__(5);
	var Webtask = __webpack_require__(6);
	var app = express();
	var Request = __webpack_require__(7);
	var memoizer = __webpack_require__(8);
	var httpRequest = __webpack_require__(7);
	var metadata = __webpack_require__(9);

	function lastLogCheckpoint(req, res) {
	  var ctx = req.webtaskContext;
	  var required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'LOGSTASH_URL', 'LOGSTASH_INDEX'];
	  var missing_settings = required_settings.filter(function (setting) {
	    return !ctx.data[setting];
	  });

	  if (missing_settings.length) {
	    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
	  }

	  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
	  req.webtaskContext.storage.get(function (err, data) {
	    var startFromId = ctx.data.START_FROM ? ctx.data.START_FROM : null;
	    var startCheckpointId = typeof data === 'undefined' ? startFromId : data.checkpointId;

	    /*
	      this primes the http request with the eventual message
	      and necessary HTTP info
	     */
	    var optionsFactory = function optionsFactory(body) {
	      return {
	        method: 'POST',
	        url: ctx.data.LOGSTASH_URL,
	        headers: {
	          'cache-control': 'no-cache',
	          'content-type': 'application/json' },
	        body: body,
	        json: true
	      };
	    };

	    // Start the process.
	    async.waterfall([function (callback) {
	      var getLogs = function getLogs(context) {
	        console.log('Logs from: ' + (context.checkpointId || 'Start') + '.');

	        var take = Number.parseInt(ctx.data.BATCH_SIZE);

	        take = take > 100 ? 100 : take;

	        context.logs = context.logs || [];

	        getLogsFromAuth0(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, function (logs, err) {
	          if (err) {
	            return callback({ error: err, message: 'Error getting logs from Auth0' });
	          }

	          if (logs && logs.length) {
	            logs.forEach(function (l) {
	              return context.logs.push(l);
	            });
	            context.checkpointId = context.logs[context.logs.length - 1]._id;
	          }

	          console.log('Total logs: ' + context.logs.length + '.');
	          return callback(null, context);
	        });
	      };

	      getLogs({ checkpointId: startCheckpointId });
	    }, function (context, callback) {
	      var min_log_level = parseInt(ctx.data.LOG_LEVEL) || 0;
	      var log_matches_level = function log_matches_level(log) {
	        if (logTypes[log.type]) {
	          return logTypes[log.type].level >= min_log_level;
	        }
	        return true;
	      };

	      var types_filter = ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',') || [];
	      var log_matches_types = function log_matches_types(log) {
	        if (!types_filter || !types_filter.length) return true;
	        return log.type && types_filter.indexOf(log.type) >= 0;
	      };

	      context.logs = context.logs.filter(function (l) {
	        return l.type !== 'sapi' && l.type !== 'fapi';
	      }).filter(log_matches_level).filter(log_matches_types);

	      callback(null, context);
	    }, function (context, callback) {
	      console.log('Uploading blobs...');

	      var now = Date.now();

	      async.eachLimit(context.logs, 100, function (log, cb) {
	        var date = moment(log.date);
	        var url = date.format('YYYY/MM/DD') + '/' + date.format('HH') + '/' + log._id + '.json';
	        var body = {};
	        body.post_date = now;
	        body[ctx.data.LOGSTASH_INDEX] = log[ctx.data.LOGSTASH_INDEX] || 'auth0';
	        body.message = JSON.stringify(log);
	        httpRequest(optionsFactory(body), function (error /*, response, body */) {
	          if (error) {
	            return cb(error);
	          }
	          return cb();
	        });
	      }, function (err) {
	        if (err) {
	          return callback({ error: err, message: 'Error sending logs to Logstash' });
	        }

	        console.log('Upload complete.');
	        return callback(null, context);
	      });
	    }], function (err, context) {
	      if (err) {
	        console.log('Job failed.', err);

	        return req.webtaskContext.storage.set({ checkpointId: startCheckpointId }, { force: 1 }, function (error) {
	          if (error) {
	            return res.status(500).send({ error: error, message: 'Error storing startCheckpoint' });
	          }

	          res.status(500).send(err);
	        });
	      }

	      console.log('Job complete.');

	      return req.webtaskContext.storage.set({
	        checkpointId: context.checkpointId,
	        totalLogsProcessed: context.logs.length
	      }, { force: 1 }, function (error) {
	        if (error) {
	          return res.status(500).send({ error: error, message: 'Error storing checkpoint' });
	        }

	        res.sendStatus(200);
	      });
	    });
	  });
	}

	var logTypes = (_logTypes = {
	  's': {
	    event: 'Success Login',
	    level: 1 // Info
	  },
	  'seacft': {
	    event: 'Success Exchange',
	    level: 1 // Info
	  },
	  'seccft': {
	    event: 'Success Exchange (Client Credentials)',
	    level: 1 // Info
	  },
	  'feacft': {
	    event: 'Failed Exchange',
	    level: 3 // Error
	  },
	  'feccft': {
	    event: 'Failed Exchange (Client Credentials)',
	    level: 3 // Error
	  },
	  'f': {
	    event: 'Failed Login',
	    level: 3 // Error
	  },
	  'w': {
	    event: 'Warnings During Login',
	    level: 2 // Warning
	  },
	  'du': {
	    event: 'Deleted User',
	    level: 1 // Info
	  },
	  'fu': {
	    event: 'Failed Login (invalid email/username)',
	    level: 3 // Error
	  },
	  'fp': {
	    event: 'Failed Login (wrong password)',
	    level: 3 // Error
	  },
	  'fc': {
	    event: 'Failed by Connector',
	    level: 3 // Error
	  },
	  'fco': {
	    event: 'Failed by CORS',
	    level: 3 // Error
	  },
	  'con': {
	    event: 'Connector Online',
	    level: 1 // Info
	  },
	  'coff': {
	    event: 'Connector Offline',
	    level: 3 // Error
	  },
	  'fcpro': {
	    event: 'Failed Connector Provisioning',
	    level: 4 // Critical
	  },
	  'ss': {
	    event: 'Success Signup',
	    level: 1 // Info
	  },
	  'fs': {
	    event: 'Failed Signup',
	    level: 3 // Error
	  },
	  'cs': {
	    event: 'Code Sent',
	    level: 0 // Debug
	  },
	  'cls': {
	    event: 'Code/Link Sent',
	    level: 0 // Debug
	  },
	  'sv': {
	    event: 'Success Verification Email',
	    level: 0 // Debug
	  },
	  'fv': {
	    event: 'Failed Verification Email',
	    level: 0 // Debug
	  },
	  'scp': {
	    event: 'Success Change Password',
	    level: 1 // Info
	  },
	  'fcp': {
	    event: 'Failed Change Password',
	    level: 3 // Error
	  },
	  'sce': {
	    event: 'Success Change Email',
	    level: 1 // Info
	  },
	  'fce': {
	    event: 'Failed Change Email',
	    level: 3 // Error
	  },
	  'scu': {
	    event: 'Success Change Username',
	    level: 1 // Info
	  },
	  'fcu': {
	    event: 'Failed Change Username',
	    level: 3 // Error
	  },
	  'scpn': {
	    event: 'Success Change Phone Number',
	    level: 1 // Info
	  },
	  'fcpn': {
	    event: 'Failed Change Phone Number',
	    level: 3 // Error
	  },
	  'svr': {
	    event: 'Success Verification Email Request',
	    level: 0 // Debug
	  },
	  'fvr': {
	    event: 'Failed Verification Email Request',
	    level: 3 // Error
	  },
	  'scpr': {
	    event: 'Success Change Password Request',
	    level: 0 // Debug
	  },
	  'fcpr': {
	    event: 'Failed Change Password Request',
	    level: 3 // Error
	  },
	  'fn': {
	    event: 'Failed Sending Notification',
	    level: 3 // Error
	  },
	  'sapi': {
	    event: 'API Operation'
	  },
	  'fapi': {
	    event: 'Failed API Operation'
	  },
	  'limit_wc': {
	    event: 'Blocked Account',
	    level: 4 // Critical
	  },
	  'limit_ui': {
	    event: 'Too Many Calls to /userinfo',
	    level: 4 // Critical
	  },
	  'api_limit': {
	    event: 'Rate Limit On API',
	    level: 4 // Critical
	  },
	  'sdu': {
	    event: 'Successful User Deletion',
	    level: 1 // Info
	  },
	  'fdu': {
	    event: 'Failed User Deletion',
	    level: 3 // Error
	  }
	}, _defineProperty(_logTypes, 'fapi', {
	  event: 'Failed API Operation',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_wc', {
	  event: 'Blocked Account',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_mu', {
	  event: 'Blocked IP Address',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'slo', {
	  event: 'Success Logout',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'flo', {
	  event: ' Failed Logout',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'sd', {
	  event: 'Success Delegation',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'fd', {
	  event: 'Failed Delegation',
	  level: 3 // Error
	}), _logTypes);

	function getLogsFromAuth0(domain, token, take, from, cb) {
	  var url = 'https://' + domain + '/api/v2/logs';

	  Request({
	    method: 'GET',
	    url: url,
	    json: true,
	    qs: {
	      take: take,
	      from: from,
	      sort: 'date:1',
	      per_page: take
	    },
	    headers: {
	      Authorization: 'Bearer ' + token,
	      Accept: 'application/json'
	    }
	  }, function (err, res, body) {
	    if (err) {
	      console.log('Error getting logs', err);
	      cb(null, err);
	    } else {
	      cb(body);
	    }
	  });
	}

	var getTokenCached = memoizer({
	  load: function load(apiUrl, audience, clientId, clientSecret, cb) {
	    Request({
	      method: 'POST',
	      url: apiUrl,
	      json: true,
	      body: {
	        audience: audience,
	        grant_type: 'client_credentials',
	        client_id: clientId,
	        client_secret: clientSecret
	      }
	    }, function (err, res, body) {
	      if (err) {
	        cb(null, err);
	      } else {
	        cb(body.access_token);
	      }
	    });
	  },
	  hash: function hash(apiUrl) {
	    return apiUrl;
	  },
	  max: 100,
	  maxAge: 1000 * 60 * 60
	});

	app.use(function (req, res, next) {
	  var apiUrl = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
	  var audience = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';
	  var clientId = req.webtaskContext.data.AUTH0_CLIENT_ID;
	  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

	  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
	    if (err) {
	      console.log('Error getting access_token', err);
	      return next(err);
	    }

	    req.access_token = access_token;
	    next();
	  });
	});

	app.get('/', lastLogCheckpoint);
	app.post('/', lastLogCheckpoint);

	// This endpoint would be called by webtask-gallery when the extension is installed as custom-extension
	app.get('/meta', function (req, res) {
	  res.status(200).send(metadata);
	});

	module.exports = Webtask.fromExpress(app);

/***/ }),
/* 1 */
/***/ (function(module, exports) {

	module.exports = require("winston");

/***/ }),
/* 2 */
/***/ (function(module, exports) {

	module.exports = require("async");

/***/ }),
/* 3 */
/***/ (function(module, exports) {

	module.exports = require("moment");

/***/ }),
/* 4 */
/***/ (function(module, exports) {

	module.exports = require("useragent");

/***/ }),
/* 5 */
/***/ (function(module, exports) {

	module.exports = require("express");

/***/ }),
/* 6 */
/***/ (function(module, exports) {

	module.exports = require("webtask-tools");

/***/ }),
/* 7 */
/***/ (function(module, exports) {

	module.exports = require("request");

/***/ }),
/* 8 */
/***/ (function(module, exports) {

	module.exports = require("lru-memoizer");

/***/ }),
/* 9 */
/***/ (function(module, exports) {

	module.exports = {
		"title": "Auth0 Logs to Logstash",
		"name": "auth0-logs-to-logstash",
		"version": "1.5.0",
		"author": "auth0",
		"description": "This extension will take all of your Auth0 logs and export them to Logstash",
		"type": "cron",
		"repository": "https://github.com/auth0/auth0-logs-to-logstash",
		"keywords": [
			"auth0",
			"extension"
		],
		"schedule": "0 */5 * * * *",
		"auth0": {
			"scopes": "read:logs"
		},
		"secrets": {
			"BATCH_SIZE": {
				"description": "The ammount of logs to be read on each execution. Maximun is 100.",
				"default": 100
			},
			"LOGSTASH_URL": {
				"description": "Logstash URL (as defined for use with logstash-input-http plugin)",
				"required": true
			},
			"LOGSTASH_INDEX": {
				"description": "Logstash Index (as defined in logstash setup",
				"required": true
			},
			"LOG_LEVEL": {
				"description": "This allows you to specify the log level of events that need to be sent",
				"type": "select",
				"allowMultiple": true,
				"options": [
					{
						"value": "-",
						"text": ""
					},
					{
						"value": "0",
						"text": "Debug"
					},
					{
						"value": "1",
						"text": "Info"
					},
					{
						"value": "2",
						"text": "Warning"
					},
					{
						"value": "3",
						"text": "Error"
					},
					{
						"value": "4",
						"text": "Critical"
					}
				]
			},
			"LOG_TYPES": {
				"description": "If you only want to send events with a specific type (eg: failed logins)",
				"type": "select",
				"allowMultiple": true,
				"options": [
					{
						"value": "-",
						"text": ""
					},
					{
						"value": "s",
						"text": "Success Login (Info)"
					},
					{
						"value": "seacft",
						"text": "Success Exchange (Info)"
					},
					{
						"value": "feacft",
						"text": "Failed Exchange (Error)"
					},
					{
						"value": "f",
						"text": "Failed Login (Error)"
					},
					{
						"value": "w",
						"text": "Warnings During Login (Warning)"
					},
					{
						"value": "du",
						"text": "Deleted User (Info)"
					},
					{
						"value": "fu",
						"text": "Failed Login (invalid email/username) (Error)"
					},
					{
						"value": "fp",
						"text": "Failed Login (wrong password) (Error)"
					},
					{
						"value": "fc",
						"text": "Failed by Connector (Error)"
					},
					{
						"value": "fco",
						"text": "Failed by CORS (Error)"
					},
					{
						"value": "con",
						"text": "Connector Online (Info)"
					},
					{
						"value": "coff",
						"text": "Connector Offline (Error)"
					},
					{
						"value": "fcpro",
						"text": "Failed Connector Provisioning (Critical)"
					},
					{
						"value": "ss",
						"text": "Success Signup (Info)"
					},
					{
						"value": "fs",
						"text": "Failed Signup (Error)"
					},
					{
						"value": "cs",
						"text": "Code Sent (Debug)"
					},
					{
						"value": "cls",
						"text": "Code/Link Sent (Debug)"
					},
					{
						"value": "sv",
						"text": "Success Verification Email (Debug)"
					},
					{
						"value": "fv",
						"text": "Failed Verification Email (Debug)"
					},
					{
						"value": "scp",
						"text": "Success Change Password (Info)"
					},
					{
						"value": "fcp",
						"text": "Failed Change Password (Error)"
					},
					{
						"value": "sce",
						"text": "Success Change Email (Info)"
					},
					{
						"value": "fce",
						"text": "Failed Change Email (Error)"
					},
					{
						"value": "scu",
						"text": "Success Change Username (Info)"
					},
					{
						"value": "fcu",
						"text": "Failed Change Username (Error)"
					},
					{
						"value": "scpn",
						"text": "Success Change Phone Number (Info)"
					},
					{
						"value": "fcpn",
						"text": "Failed Change Phone Number (Error)"
					},
					{
						"value": "svr",
						"text": "Success Verification Email Request (Debug)"
					},
					{
						"value": "fvr",
						"text": "Failed Verification Email Request (Error)"
					},
					{
						"value": "scpr",
						"text": "Success Change Password Request (Debug)"
					},
					{
						"value": "fcpr",
						"text": "Failed Change Password Request (Error)"
					},
					{
						"value": "fn",
						"text": "Failed Sending Notification (Error)"
					},
					{
						"value": "limit_wc",
						"text": "Blocked Account (Critical)"
					},
					{
						"value": "limit_ui",
						"text": "Too Many Calls to /userinfo (Critical)"
					},
					{
						"value": "api_limit",
						"text": "Rate Limit On API (Critical)"
					},
					{
						"value": "sdu",
						"text": "Successful User Deletion (Info)"
					},
					{
						"value": "fdu",
						"text": "Failed User Deletion (Error)"
					}
				]
			},
			"START_FROM": {
				"description": "The Auth0 LogId from where you want to start."
			}
		}
	};

/***/ })
/******/ ]);