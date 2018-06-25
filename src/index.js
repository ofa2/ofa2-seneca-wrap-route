import _ from 'lodash';

function plainMsg(msg) {
  return _.omit(msg, [
    'cmd',
    'action',
    'role',
    'transport$',
    'id$',
    'plugin$',
    'fatal$',
    'tx$',
    'meta$',
    'traceId',
  ]);
}

function logRequest(type, level, msg) {
  if (type === true) {
    logger[level](msg.cmd);
  }
  else if (type === 'all') {
    logger[level](msg);
  }
  else if (type === 'plain') {
    logger[level](msg.cmd, plainMsg(msg));
  }
}

function logResponse(start, type, level, msg, result) {
  let ms = Date.now() - start;

  if (result instanceof Errors.OperationalError) {
    result.seneca = plainMsg(msg);
    result.seneca.cmd = msg.cmd;
    result.seneca.costMs = ms;
    logger.warn(result);
  }
  else if (result instanceof Error) {
    result.seneca = msg;
    result.seneca.costMs = ms;
    logger.error(result);
  }
  else if (type === true) {
    logger[level](`done ${msg.cmd} -- ${ms}ms`);
  }
  else if (type === 'plain') {
    logger[level](`done ${msg.cmd} -- ${ms}ms`, result);
  }
}

function wrapRoute() {
  if (!this.seneca) {
    throw new Error('no seneca found');
  }

  this.seneca.plainMsg = plainMsg;

  _.forEach(this.config.routes, (action, key) => {
    let index = key.indexOf(' ');
    let keyParts = [key.slice(0, index), key.slice(index + 1)];
    let method = (keyParts[0] || '').toLowerCase();

    if (!_.includes(['add', 'wrap'], method)) {
      throw new Error(`invalid route method: ${method}`);
    }

    let actionParts = action.split('.');
    let controllerName = actionParts[0];
    let controller = this.controllers[controllerName];
    if (!controller) {
      throw new Error(`undefined controller: ${controllerName}`);
    }

    let actionMethodName = actionParts[1];
    let actionMethod = controller[actionMethodName].bind(controller);
    if (!actionMethod) {
      throw new Error(`undefined action method: ${action}`);
    }

    let { requestLog, requestLogLevel = 'trace' } = this.config.seneca;
    let { responseLog, responseLogLevel = 'trace' } = this.config.seneca;

    controller[actionMethodName] = async function actionAsync(msg, done) {
      let { traceId } = msg;
      if (traceId) {
        if (global.als) {
          global.als.set('traceId', traceId);
        }
      }

      const start = Date.now();
      logRequest(requestLog, requestLogLevel, msg);

      try {
        let result = await actionMethod(msg);
        logResponse(start, responseLog, responseLogLevel, msg, result);
        return done(null, result);
      }
      catch (err) {
        logResponse(start, responseLog, responseLogLevel, msg, err);

        if (err instanceof Errors.OperationalError) {
          return done(null, err.response());
        }

        return done(null, new Errors.Unknown().response());
      }
    };
  });
}

export default wrapRoute;
