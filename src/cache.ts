import { noop } from 'lodash';
import { isBrowser } from './utils';

const CACHE_KEY = 'covid#cache';

const localStorage = isBrowser
  ? window.localStorage
  : ({ getItem: noop, setItem: noop } as Storage);

export function getData<T>() {
  try {
    const cache = localStorage.getItem(CACHE_KEY);
    if (cache) {
      return JSON.parse(cache) as T;
    }
    return null;
  } catch (err) {
    return null;
  }
}

export function saveData<T>(data: T) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
}
