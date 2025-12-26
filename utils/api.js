// Define base URL - can be changed for different environments
// For production, this should be changed to the actual server URL
const baseUrl = 'http://127.0.0.1:3000'; // Change this for production deployment

function request(method, url, data) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: baseUrl + url,
      method,
      data,
      dataType: 'text',
      success: (r) => {
        let body = r.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); }
          catch (e) { return resolve({ code: 1, msg: 'api not json' }); }
        }
        resolve(body);
      },
      fail: reject
    });
  });
}

export const get = (url, data) => request('GET', url, data);
export const post = (url, data) => request('POST', url, data);
export const put = (url, data) => request('PUT', url, data);
export const del = (url, data) => request('DELETE', url, data);