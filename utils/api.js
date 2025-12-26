/**
 * API 请求工具模块
 * 封装 uni.request，提供统一的请求入口和响应处理
 */
const baseUrl = 'http://127.0.0.1:3000';

/**
 * 通用请求函数
 * @param {string} method - HTTP 方法：GET/POST/PUT/DELETE
 * @param {string} url - 请求路径
 * @param {object} data - 请求体数据
 * @returns {Promise} 包含解析后的响应数据
 */
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

// 导出各 HTTP 方法的简写，便于调用
export const get = (url, data) => request('GET', url, data);
export const post = (url, data) => request('POST', url, data);
export const put = (url, data) => request('PUT', url, data);
export const del = (url, data) => request('DELETE', url, data);