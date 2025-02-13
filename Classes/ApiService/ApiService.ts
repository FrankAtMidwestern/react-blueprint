/**
 * ApiService.ts
 * 
 * Supports HTTP methods (GET, POST, PUT,
 * PATCH, DELETE, HEAD, OPTIONS) as well as GraphQL. This service uses a pluggable HTTP adapter
 * pattern so that any HTTP client (fetch, axios, XHR, etc.) can be used. It supports query parameters,
 * arbitrary request bodies, credentials, tokens, abort signals, timeouts, progress tracking, and detailed error handling.
 */

export interface HttpRequestConfig {
    method: string;
    url: string;
    headers?: { [key: string]: string };
    queryParams?: {
      [key: string]:
        | string
        | number
        | boolean
        | null
        | undefined
        | (string | number | boolean)[];
    };
    body?: any;
    timeout?: number;
    credentials?: RequestCredentials;
    abortSignal?: AbortSignal;
    /**
     * Optional progress callback.
     * For adapters that support progress events (such as those using XHR or axios),
     * this callback will be called with ProgressEvent updates.
     */
    onProgress?: (progressEvent: ProgressEvent) => void;
  }
  
  export interface HttpResponse<T = any> {
    status: number;
    statusText: string;
    headers: { [key: string]: string };
    data: T;
  }
  
  /**
   * A pluggable HTTP client adapter. Given a configuration object, returns a Promise
   * resolving to an HttpResponse.
   */
  export type HttpClientAdapter = (config: HttpRequestConfig) => Promise<HttpResponse>;
  
  export interface ApiServiceConfig {
    baseUrl?: string;
    defaultHeaders?: { [key: string]: string };
    credentials?: RequestCredentials;
    token?: string;
    timeout?: number;
    httpAdapter?: HttpClientAdapter;
  }
  
  /**
   * Defines error types for ApiService.
   */
  export type ApiErrorType = "network" | "timeout" | "abort" | "http";
  
  /**
   * Custom error class for ApiService errors.
   */
  export class ApiServiceError extends Error {
    public status: number;
    public response?: HttpResponse;
    public errorType: ApiErrorType;
  
    constructor(
      message: string,
      status: number,
      errorType: ApiErrorType,
      response?: HttpResponse
    ) {
      super(message);
      this.status = status;
      this.errorType = errorType;
      this.response = response;
      Object.setPrototypeOf(this, ApiServiceError.prototype);
    }
  }
  
  /**
   * RequestOptions defines the options accepted by the internal request method.
   */
  export interface RequestOptions {
    headers?: { [key: string]: string };
    queryParams?: {
      [key: string]:
        | string
        | number
        | boolean
        | null
        | undefined
        | (string | number | boolean)[];
    };
    body?: any;
    timeout?: number;
    credentials?: RequestCredentials;
    abortSignal?: AbortSignal;
    /**
     * Optional progress callback. If provided and supported by the adapter,
     * this will be called with progress events.
     */
    onProgress?: (progressEvent: ProgressEvent) => void;
  }
  
  /**
   * Merges two AbortSignals into one.
   * The merged signal aborts if either input signal aborts.
   */
  function mergeAbortSignals(
    signalA?: AbortSignal,
    signalB?: AbortSignal
  ): AbortSignal | undefined {
    if (!signalA) return signalB;
    if (!signalB) return signalA;
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort();
    };
    signalA.addEventListener("abort", onAbort);
    signalB.addEventListener("abort", onAbort);
    return controller.signal;
  }
  
  /**
   * Default HTTP adapter that uses the global fetch API.
   * Uses AbortController to abort the request when a timeout occurs.
   * 
   * Note: The fetch API does not support progress events, so if an onProgress callback is provided,
   * a warning is issued.
   */
  export async function defaultHttpAdapter(
    config: HttpRequestConfig
  ): Promise<HttpResponse> {
    if (typeof fetch !== "function") {
      throw new Error("No HTTP adapter provided and fetch is not available.");
    }
  
    if (config.onProgress) {
      console.warn("Progress tracking is not supported by the default fetch adapter.");
    }
  
    // Build the URL with query parameters.
    let url = config.url;
    if (config.queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(config.queryParams)) {
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) {
          value.forEach((item) => params.append(key, String(item)));
        } else {
          params.append(key, String(value));
        }
      }
      const qs = params.toString();
      if (qs) {
        url += (url.includes("?") ? "&" : "?") + qs;
      }
    }
  
    // Build fetch options.
    const fetchOptions: RequestInit = {
      method: config.method,
      headers: config.headers,
      credentials: config.credentials,
    };
  
    // Handle request body:
    // Only stringify if the body is not a string and if Content-Type indicates JSON.
    let requestBody = config.body;
    const contentType =
      config.headers &&
      (config.headers["Content-Type"] || config.headers["content-type"]);
    if (
      requestBody &&
      typeof requestBody !== "string" &&
      !(requestBody instanceof FormData) &&
      !(requestBody instanceof Blob)
    ) {
      if (contentType && contentType.includes("application/json")) {
        requestBody = JSON.stringify(requestBody);
      }
    }
    if (requestBody) {
      fetchOptions.body = requestBody;
    }
  
    // Setup timeout using AbortController.
    let timeoutController: AbortController | undefined;
    if (config.timeout) {
      timeoutController = new AbortController();
      setTimeout(() => {
        timeoutController?.abort();
      }, config.timeout);
    }
  
    // Combine the user’s abortSignal with the timeout controller’s signal.
    const combinedSignal = mergeAbortSignals(
      config.abortSignal,
      timeoutController ? timeoutController.signal : undefined
    );
    if (combinedSignal) {
      fetchOptions.signal = combinedSignal;
    }
  
    try {
      const response = await fetch(url, fetchOptions);
      const headersObj: { [key: string]: string } = {};
      response.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      let data: any;
      try {
        data = await response.json();
      } catch (e) {
        data = await response.text();
      }
      return {
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        data,
      };
    } catch (error: any) {
      throw error;
    }
  }
  
  /**
   * ApiService
   *
   * A robust API service that supports HTTP methods GET, POST, PUT, PATCH, DELETE,
   * HEAD, OPTIONS, and GraphQL. Uses a pluggable HTTP adapter (defaulting to fetch) and
   * supports query parameters, arbitrary payloads, credentials, tokens, abort signals,
   * timeouts, progress tracking, and detailed error handling.
   */
  export class ApiService {
    private config: ApiServiceConfig;
    private adapter: HttpClientAdapter;
  
    constructor(config: ApiServiceConfig = {}) {
      this.config = config;
      this.adapter = config.httpAdapter || defaultHttpAdapter;
    }
  
    /**
     * Builds the full URL by prepending the baseUrl if provided.
     */
    private buildUrl(endpoint: string): string {
      if (this.config.baseUrl) {
        return `${this.config.baseUrl.replace(/\/+$/, "")}/${endpoint.replace(
          /^\/+/,
          ""
        )}`;
      }
      return endpoint;
    }
  
    /**
     * Merges default headers, the token (if provided), and custom headers.
     * Does not force a Content-Type header.
     */
    private buildHeaders(
      customHeaders?: { [key: string]: string }
    ): { [key: string]: string } {
      const headers = { ...(this.config.defaultHeaders || {}), ...(customHeaders || {}) };
      if (this.config.token && !headers["Authorization"]) {
        headers["Authorization"] = `Bearer ${this.config.token}`;
      }
      return headers;
    }
  
    /**
     * Helper function to perform an HTTP request.
     */
    private async request<T>(
      method: string,
      endpoint: string,
      options: RequestOptions = {}
    ): Promise<HttpResponse<T>> {
      const url = this.buildUrl(endpoint);
      const headers = this.buildHeaders(options.headers);
      const timeout = options.timeout ?? this.config.timeout;
      const credentials = options.credentials ?? this.config.credentials;
  
      const requestConfig: HttpRequestConfig = {
        method: method.toUpperCase(),
        url,
        headers,
        queryParams: options.queryParams,
        body: options.body,
        timeout,
        credentials,
        abortSignal: options.abortSignal,
        onProgress: options.onProgress, // Pass along the progress callback.
      };
  
      let response: HttpResponse<T>;
      try {
        response = await this.adapter(requestConfig);
      } catch (error: any) {
        if (error.name === "AbortError") {
          if (timeout && error.message && error.message.includes("timeout")) {
            throw new ApiServiceError("Request timed out", 0, "timeout");
          }
          throw new ApiServiceError("Request was aborted", 0, "abort");
        }
        throw new ApiServiceError(error.message || "Network error", 0, "network");
      }
  
      if (response.status < 200 || response.status >= 300) {
        throw new ApiServiceError(
          `HTTP error ${response.status}: ${response.statusText}`,
          response.status,
          "http",
          response
        );
      }
      return response;
    }
  
    // Helper methods that derive the proper options type (using index [2] from request).
    
    public get<T>(
      endpoint: string,
      options?: Omit<Parameters<ApiService["request"]>[2], "body">
    ): Promise<HttpResponse<T>> {
      return this.request<T>("GET", endpoint, options);
    }
    
    public post<T>(
      endpoint: string,
      options?: Parameters<ApiService["request"]>[2] & { body?: any }
    ): Promise<HttpResponse<T>> {
      return this.request<T>("POST", endpoint, options);
    }
    
    public put<T>(
      endpoint: string,
      options?: Parameters<ApiService["request"]>[2] & { body?: any }
    ): Promise<HttpResponse<T>> {
      return this.request<T>("PUT", endpoint, options);
    }
    
    public patch<T>(
      endpoint: string,
      options?: Parameters<ApiService["request"]>[2] & { body?: any }
    ): Promise<HttpResponse<T>> {
      return this.request<T>("PATCH", endpoint, options);
    }
    
    public delete<T>(
      endpoint: string,
      options?: Omit<Parameters<ApiService["request"]>[2], "body">
    ): Promise<HttpResponse<T>> {
      return this.request<T>("DELETE", endpoint, options);
    }
    
    public head<T>(
      endpoint: string,
      options?: Omit<Parameters<ApiService["request"]>[2], "body">
    ): Promise<HttpResponse<T>> {
      return this.request<T>("HEAD", endpoint, options);
    }
    
    public options<T>(
      endpoint: string,
      options?: Omit<Parameters<ApiService["request"]>[2], "body">
    ): Promise<HttpResponse<T>> {
      return this.request<T>("OPTIONS", endpoint, options);
    }
    
    /**
     * Convenience method for making GraphQL requests.
     * Sends a POST request with the provided query and variables.
     */
    public graphql<T>(
      endpoint: string,
      query: string,
      variables?: { [key: string]: any },
      options?: {
        headers?: { [key: string]: string };
        queryParams?: {
          [key: string]:
            | string
            | number
            | boolean
            | null
            | undefined
            | (string | number | boolean)[];
        };
        timeout?: number;
        credentials?: RequestCredentials;
        abortSignal?: AbortSignal;
        onProgress?: (progressEvent: ProgressEvent) => void;
      }
    ): Promise<HttpResponse<T>> {
      const body = { query, variables };
      const headers = { "Content-Type": "application/json", ...(options?.headers || {}) };
      return this.request<T>("POST", endpoint, { ...options, headers, body });
    }
  }
  