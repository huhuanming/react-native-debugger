const isWorkerMethod = fn => String(fn).indexOf('[native code]') > -1;

/* eslint-disable no-underscore-dangle */
let networkInspect;

// Disable `support.blob` in `whatwg-fetch` for use native XMLHttpRequest,
// See https://github.com/jhen0409/react-native-debugger/issues/56
const toggleBlobOfFetchSupport = disabled => {
  // Ensure the initial script of `whatwg-fetch` is executed because it's lazy property,
  // see https://github.com/facebook/react-native/blob/0.54-stable/Libraries/Core/InitializeCore.js#L89
  self.fetch; // eslint-disable-line

  if (!self.__FETCH_SUPPORT__) return;
  if (disabled) {
    self.__FETCH_SUPPORT__._blobBackup = self.__FETCH_SUPPORT__.blob;
    self.__FETCH_SUPPORT__.blob = false;
  } else {
    self.__FETCH_SUPPORT__.blob = !!self.__FETCH_SUPPORT__._blobBackup;
    delete self.__FETCH_SUPPORT__._blobBackup;
  }
};

export const toggleNetworkInspect = (enabled, NativeModules) => {
  if (!enabled && networkInspect) {
    self.XMLHttpRequest = networkInspect.XMLHttpRequest;
    self.FormData = networkInspect.FormData;
    networkInspect = null;
    toggleBlobOfFetchSupport(false);
    return;
  }
  if (!enabled) return;
  if (enabled && networkInspect) return;
  if (isWorkerMethod(self.XMLHttpRequest) || isWorkerMethod(self.FormData)) {
    console.warn(
      '[RNDebugger] ' +
        'I tried to enable Network Inspect but XHR ' +
        "have been replaced by worker's XHR. " +
        'You can disable Network Inspect (documentation: https://goo.gl/BVvEkJ) ' +
        'or tracking your app code if you have called ' +
        '`global.XMLHttpRequest = global.originalXMLHttpRequest`.'
    );
    return;
  }
  networkInspect = {
    XMLHttpRequest: self.XMLHttpRequest,
    FormData: self.FormData,
  };
  self.XMLHttpRequest = self.originalXMLHttpRequest
    ? self.originalXMLHttpRequest
    : self.XMLHttpRequest;

  const originaOpen = self.XMLHttpRequest.prototype.open;
  self.XMLHttpRequest.prototype.open = function open(...args) {
    this._url = args[1];
    return originaOpen.apply(this, args);
  };

  const originalSend = self.XMLHttpRequest.prototype.send;
  self.XMLHttpRequest.prototype.send = function send(...args) {
    // Cannot work on React Native 0.54 version
    // https://github.com/facebook/react-native/issues/16434
    // const url = new URL(this._url);
    // const domainName = url.host;
    const domainName = this._url.split('/')[2];
    if (NativeModules) {
      const { RNCookieManagerAndroid, RNCookieManagerIOS } = NativeModules;
      if (RNCookieManagerIOS && RNCookieManagerIOS.getAll) {
        RNCookieManagerIOS.getAll((cookies) => {
          const cookieString = Object.keys(cookies).reduce((pre, next) => {
            const { name, value, domain } = cookies[next];
            if (domain === domainName) {
              return `${pre}; ${name}=${value}`;
            }
            return pre;
          }, '');
          this.setRequestHeader('Cookie', cookieString);
          originalSend.apply(this, args);
        });
      }

      if (RNCookieManagerAndroid && RNCookieManagerAndroid.fetchCookieForDomain) {
        RNCookieManagerAndroid.fetchCookieForDomain(domainName, (cookies) => {
          this.setRequestHeader('Cookie', cookies);
          originalSend.call(this, args);
        });
      }
    } else {
      originalSend.call(this, args);
    }
  };

  self.FormData = self.originalFormData ? self.originalFormData : self.FormData;

  toggleBlobOfFetchSupport(true);
  console.log(
    '[RNDebugger]',
    'Network Inspect is enabled,',
    'see the documentation (https://goo.gl/yEcRrU) for more information.'
  );
};

/*
 * `originalXMLHttpRequest` haven't permission to set forbidden header name
 * (https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name)
 * We have to use Electron session to solve this problem (See electron/main.js)
 */
const forbiddenHeaderNames = [
  'Accept-Charset',
  'Accept-Encoding',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'Connection',
  'Content-Length',
  'Cookie',
  'Cookie2',
  'Date',
  'DNT',
  'Expect',
  'Host',
  'Keep-Alive',
  'Origin',
  'Referer',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'Via',
  // Actually it still blocked on Chrome
  'User-Agent',
];
forbiddenHeaderNames.forEach(name => forbiddenHeaderNames.push(name.toLowerCase()));

const isForbiddenHeaderName = header =>
  forbiddenHeaderNames.includes(header) ||
  header.startsWith('Proxy-') ||
  header.startsWith('proxy-') ||
  header.startsWith('Sec-') ||
  header.startsWith('sec-');

export const replaceForbiddenHeadersForWorkerXHR = () => {
  if (!isWorkerMethod(self.XMLHttpRequest)) return;
  const originalSetRequestHeader = self.XMLHttpRequest.prototype.setRequestHeader;
  self.XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(header, value) {
    let replacedHeader = header;
    if (isForbiddenHeaderName(header)) {
      replacedHeader = `__RN_DEBUGGER_SET_HEADER_REQUEST_${header}`;
    }
    return originalSetRequestHeader.call(this, replacedHeader, value);
  };
};

export const addURIWarningForWorkerFormData = () => {
  if (!isWorkerMethod(self.FormData)) return;
  const originAppend = FormData.prototype.append;
  self.FormData.prototype.append = function append(key, value) {
    if (value && value.uri) {
      console.warn(
        '[RNDebugger] ' +
          "Detected you're enabled Network Inspect and using `uri` in FormData, " +
          'it will be a problem if you use it for upload, ' +
          'please see the documentation (https://goo.gl/yEcRrU) for more information.'
      );
    }
    return originAppend.call(this, key, value);
  };
};
