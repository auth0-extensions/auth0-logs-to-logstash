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

    const sendLog = function (body, callback) {
      const url = config('LOGSTASH_TOKEN') ? `${config('LOGSTASH_URL')}?token=${config('LOGSTASH_TOKEN')}` : config('LOGSTASH_URL');
      const options = {
        method: 'POST',
        url: url,
        headers: { 'cache-control': 'no-cache', 'content-type': 'application/json' },
        body: body,
        json: true
      };

      if (config('LOGSTASH_USER') && config('LOGSTASH_PASSWORD')) {
        options['auth'] = {
          user: config('LOGSTASH_USER'),
          pass: config('LOGSTASH_PASSWORD'),
          sendImmediately: true
        }
      }

      request(options, callback);
    };

    const onLogsReceived = (logs, callback) => {
      if (!logs || !logs.length) {
        return callback();
      }

      logger.info(`Sending ${logs.length} logs to Logstash.`);

      const now = Date.now();
      async.eachLimit(logs, 100, (log, cb) => {
        const index = config('LOGSTASH_INDEX');
        const data = {};

        data.post_date = now;
        data[index] = log[index] || 'auth0';
        data.message = JSON.stringify(log);

        sendLog(data, err => cb(err));
      }, (err) => {
        if (err) {
          return callback({ error: err, message: 'Error sending logs to Logstash' });
        }

        logger.info('Upload complete.');
        return callback(null, context);
      });
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
