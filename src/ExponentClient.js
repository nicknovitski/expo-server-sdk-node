/**
 * exponent-server-sdk
 *
 * Use this if you are running Node on your server backend when you are working
 * with Exponent
 * https://getexponent.com
 *
 * @flow
 */
import invariant from 'invariant';
import fetch, { Headers, Response as FetchResponse } from 'node-fetch';

const BASE_URL = 'https://exp.host/';
const BASE_API_URL = `${BASE_URL}--/api/v2`;

// TODO: Eventually we'll want to have developers authenticate. Right now it's
// not necessary because push notifications are the only API we have and the
// push tokens are secret anyway.
export default class ExponentClient {
  /**
   * Returns `true` if the token is an Exponent push token
   */
  isExponentPushToken(token: ExponentPushToken): boolean {
    return (typeof token === 'string') && token.startsWith('ExponentPushToken');
  }

  /**
   * Sends the given message to its recipient via a push notification
   */
  async sendPushNotificationAsync(
    message: ExponentPushMessage,
  ): Promise<ExponentPushReceipt> {
    let receipts = await this.sendPushNotificationsAsync([message]);
    invariant(receipts.length === 1, `Expected exactly one push receipt`);
    return receipts[0];
  }

  /**
   * Sends the given messages to their recipeints via push notifications and
   * returns an array of push receipts. Each receipt corresponds to the message
   * at its respective index (the nth receipt is for the nth message).
   */
  async sendPushNotificationsAsync(
    messages: ExponentPushMessage[],
  ): Promise<ExponentPushReceipt[]> {
    let data = await this._requestAsync(`${BASE_API_URL}/push/send`, {
      httpMethod: 'post',
      body: messages,
    });

    if (!Array.isArray(data) || data.length !== messages.length) {
      let apiError: Object = new Error(
        `Expected Exponent to respond with ${messages.length} ` +
        `${messages.length === 1 ? 'receipt' : 'receipts'} but got ` +
        `${data.length}`,
      );
      apiError.data = data;
      throw apiError;
    }

    return data;
  }

  async _requestAsync(
    url: string,
    options: RequestOptions,
  ): Promise<*> {
    let sdkVersion = require('../package.json').version;
    let fetchOptions = {
      method: options.httpMethod,
      body: JSON.stringify(options.body),
      headers: new Headers({
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': `exponent-server-sdk-node/${sdkVersion}`,
      }),
    };
    if (options.body != null) {
      fetchOptions.body = JSON.stringify(options.body);
      fetchOptions.headers.set('Content-Type', 'application/json');
    }

    let response = await fetch(url, fetchOptions);

    if (response.status !== 200) {
      let apiError = await this._parseErrorResponseAsync(response);
      throw apiError;
    }

    // We expect the API response body to be JSON
    let result: ApiResult;
    try {
      result = await response.json();
    } catch (e) {
      let apiError = await this._getTextResponseErrorAsync(response);
      throw apiError;
    }

    if (result.errors) {
      let apiError = this._getErrorFromResult(result);
      throw apiError;
    }

    return result.data;
  }

  async _parseErrorResponseAsync(response: FetchResponse): Promise<Error> {
    let result: ApiResult;
    try {
      result = await response.json();
    } catch (e) {
      return await this._getTextResponseErrorAsync(response);
    }

    if (!result.errors || !Array.isArray(result.errors) || !result.errors.length) {
      let apiError: Object = await this._getTextResponseErrorAsync(response);
      apiError.errorData = result;
      return apiError;
    }

    return this._getErrorFromResult(result);
  }

  async _getTextResponseErrorAsync(response: FetchResponse): Promise<Error> {
    let text = await response.text();
    let apiError: Object = new Error(
      `Exponent responded with an error with status code ${response.status}: ` +
      text,
    );
    apiError.statusCode = response.status;
    apiError.errorText = text;
    return apiError;
  }

  /**
   * Returns an error for the first API error in the result, with an optional
   * `others` field that contains any other errors.
   */
  _getErrorFromResult(result: ApiResult): Error {
    invariant(
      result.errors && result.errors.length > 0,
      `Expected at least one error from Exponent`,
    );
    let [errorData, ...otherErrorData] = (result.errors);
    let error: Object = this._getErrorFromResultError(errorData);
    if (otherErrorData.length) {
      error.others = otherErrorData.map(
        data => this._getErrorFromResultError(data),
      );
    }
    return error;
  }

  /**
   * Returns an error for a single API error
   */
  _getErrorFromResultError(errorData: ApiResultError): Error {
    let error: Object = new Error(errorData.message);
    error.code = errorData.code;

    if (errorData.details != null) {
      error.details = errorData.details;
    }

    if (errorData.stack != null) {
      error.serverStack = errorData.stack;
    }

    return error;
  }
}

export type ExponentPushToken = string;

export type ExponentPushMessage = {
  to: ExponentPushToken,
  data?: Object,
  title?: string,
  body?: string,
  sound?: 'default' | null,
  ttl?: number,
  expiration?: number,
  priority?: 'default' | 'normal' | 'high',
  badge?: number,
};

export type ExponentPushReceipt = {
  status: 'ok' | 'error',
  details?: {
    error?: 'DeviceNotRegistered' | 'MessageTooBig' | 'MessageRateExceeded',
  },
  // Internal field used only by developers working on Exponent
  __debug?: any,
};

type RequestOptions = {
  httpMethod: 'get' | 'post',
  body?: any,
};

type ApiResult = {
  errors?: ApiResultError[],
  data?: any,
};

type ApiResultError = {
  message: string,
  code: string,
  details?: any,
  stack?: string,
};
