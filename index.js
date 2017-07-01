'use strict';

const env = require('node-env-file');
const config = env(__dirname + '/.env');

//----------------------------------------
const Promise = require('bluebird');
const _ = require('lodash');
const mkdirp = Promise.promisify(require('mkdirp'));
const writeFile = Promise.promisify(require('fs').writeFile);
const Withings = require('withings-lib');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const exec = require('child_process').exec;

/**
 * @name WithingsAccessToken
 * @property {string} token
 * @property {string} secret
 * @property {string} userid
 */
/**
 * 
 */
class WithingsClient {
  
  constructor(config) {
    this.config = _.assign({}, config, {
      CREDENTIAL_PATH: './tmp/credential.json'
    });
  }
  
  async prepare() {
    
    return await this.loadAccessToken();

  }
  
  async getCredential() {
    return require(this.config.CREDENTIAL_PATH);
  }

  /**
   * コンシューマーキーから認証URLを生成、ブラウザを開き、コールバックを受け取ったらアクセストークンを返す
   * 
   * @return {Promise.<WithingsAccessToken>}
   */
  async getAccessToken() {
    const token = this.getRequestToken();
    
    console.log('Go ' + token.authorizeUrl);
    let cmd = 'open -a "Google Chrome" "' + token.authorizeUrl + '"';
    exec(cmd);

    var app = express();
    app.use(cookieParser());
    app.listen(this.config.SERVER_PORT);

    return new Promise((resolve, reject) => {
      app.get('/oauth_callback', (req, res) => {
        var verifier = req.query.oauth_verifier;
        var options = {
          consumerKey: this.config.CONSUMER_KEY,
          consumerSecret: this.config.CONSUMER_SECRET,
          callbackUrl: this.config.CALLBACK_URL,
          userID: req.query.userid
        };
        var client = new Withings(options);

        // Request an access token
        client.getAccessToken(token.token, token.secret, verifier, (err, token, secret) => {
          if (err) return reject(err);
          resolve({
            token: token,
            secret: secret,
            userid: req.query.userid
          })
        });

      });
    });
  }

  /**
   * accessTokenを取得して書き込みする
   * 
   * @return {Promise.<void>}
   */
  async saveCredential() {
    await mkdirp(path.dirname(this.config.CREDENTIAL_PATH));
    const token = await this.getAccessToken();
    await writeFile(this.config.CREDENTIAL_PATH, JSON.stringify(token));
  }

  /**
   * accessTokenがなければ取得しにいく
   * 
   * @return {Promise.<WithingsAccessToken>}
   */
  loadAccessToken() {

    return this.getCredential()
      .catch(() => {
        return this.saveCredential();
      })
      .then((token) => {
        this.accessToken = token;
      });
    
  }

  /**
   * @return {Promise.<{token: string, secret: string, authorizeUrl: string}>}
   */
  getRequestToken() {
    var options = {
      consumerKey: this.config.CONSUMER_KEY,
      consumerSecret: this.config.CONSUMER_SECRET,
      callbackUrl: this.config.CALLBACK_URL
    };
    var client = new Withings(options);

    return new Promise((resolve, reject) => {
      client.getRequestToken(function (err, token, tokenSecret) {
        if (err) return reject(err);
        resolve({
          token: token,
          secret: tokenSecret,
          authorizeUrl: client.authorizeUrl(token, tokenSecret)
        });
      });
    })
  }

  /**
   * 
   * @return {WithingsClient}
   */
  getWithingsClient() {
    var options = {
      consumerKey: this.config.CONSUMER_KEY,
      consumerSecret: this.config.CONSUMER_SECRET,
      accessToken: this.accessToken.token,
      accessTokenSecret: this.accessToken.secret,
      userID: this.accessToken.userid
    };
    var willPromise = [
      'getDailySteps',
      'getDailyCalories',
      'getWeightMeasures',
      'getPulseMeasures',
      'getSleepSummary'
    ]
    if (!this.withingsClient) {
      this.withingsClient = new Withings(options);
      for (let key of willPromise) {
        this.withingsClient[key] = Promise.promisify(this.withingsClient[key].bind(this.withingsClient));
      }
    }
    return this.withingsClient;
  }
  getStep(date) {
    return this.getWithingsClient().getDailySteps(date);
  }
  
  async run() {
    await this.prepare();
    console.log(await this.getStep(new Date()));
  }
}

const w = new WithingsClient(config);

w.run().catch((err) => {
  console.error(err, err.stack);
});
