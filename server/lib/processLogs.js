const async = require('async');
const request = require('request');
const moment = require('moment');
const loggingTools = require('auth0-log-extension-tools');

const config = require('../lib/config');
const logger = require('../lib/logger');

module.exports = (storage) =>
  (req, res, next) => {
    const wtBody = (req.webtaskContext && req.webtaskContext.body) || req.body || {};
    const wtHead = (req.webtaskContext && req.webtaskContext.headers) || {};
    const isCron = (wtBody.schedule && wtBody.state === 'active') || (wtHead.referer === 'https://manage.auth0.com/' && wtHead['if-none-match']);

    if (!isCron) {
      return next();
    }

    const now = Date.now();

    const sendLog = function (log, callback) {
      const index = config('LOGSTASH_INDEX');
      const data = {
        post_date: now
      };

      Object.keys(log).forEach((key) => {
        data[key] = log[key];
      });

      data[index] = log[index] || 'auth0';
      data.message = JSON.stringify(log);

      const url = config('LOGSTASH_TOKEN') ? `${config('LOGSTASH_URL')}?token=${config('LOGSTASH_TOKEN')}` : config('LOGSTASH_URL');
      const options = {
        method: 'POST',
        timeout: 20000,
        url: url,
        headers: { 'cache-control': 'no-cache', 'content-type': 'application/json' },
        body: data,
        json: true
      };

      if (config('LOGSTASH_USER') && config('LOGSTASH_PASSWORD')) {
        options['auth'] = {
          user: config('LOGSTASH_USER'),
          pass: config('LOGSTASH_PASSWORD'),
          sendImmediately: true
        }
      }

      request(options, (err, resp, body) => {
        const error = err || (body && body.error) || null;
        callback(error);
      });
    };

    const onLogsReceived = (logs, callback) => {
      if (!logs || !logs.length) {
        return callback();
      }

      logger.info(`Sending ${logs.length} logs to Logstash.`);

      async.eachLimit(logs, 100, sendLog, callback);
    };

    const slack = new loggingTools.reporters.SlackReporter({ hook: config('SLACK_INCOMING_WEBHOOK_URL'), username: 'auth0-logs-to-logstash', title: 'Logs To Logstash' });

    const options = {
      domain: config('AUTH0_DOMAIN'),
      clientId: config('AUTH0_CLIENT_ID'),
      clientSecret: config('AUTH0_CLIENT_SECRET'),
      batchSize: config('BATCH_SIZE'),
      startFrom: config('START_FROM'),
      logTypes: config('LOG_TYPES'),
      logLevel: config('LOG_LEVEL')
    };

    const auth0logger = new loggingTools.LogsProcessor(storage, options);

    return auth0logger
      .run(onLogsReceived)
      .then(result => {
        slack.send(result.status, result.checkpoint);
        res.json(result);
      })
      .catch(err => {
        slack.send({ error: err, logsProcessed: 0 }, null);
        next(err);
      });
  };
