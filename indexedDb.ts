
import { ContentProject } from './types';

const DB_NAME = 'co-creative-ai-hub';
const STORE_NAME = 'projects';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject('Error opening IndexedDB');
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

export const loadProjects = async (): Promise<ContentProject[]> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get('all_projects');

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => reject('Error loading projects');
    });
  } catch (error) {
    console.warn('IndexedDB load failed:', error);
    return [];
  }
};

export const saveProjects = async (projects: ContentProject[]): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(projects, 'all_projects');

      request.onsuccess = () => resolve();
      request.onerror = () => reject('Error saving projects');
    });
  } catch (error) {
    console.warn('IndexedDB save failed:', error);
  }
};
