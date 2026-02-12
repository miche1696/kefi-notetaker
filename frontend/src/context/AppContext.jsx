import React, { createContext, useContext, useState } from 'react';

const AppContext = createContext(null);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

export const AppProvider = ({ children }) => {
  const [currentFolder, setCurrentFolder] = useState('');  // Current selected folder path
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const clearError = () => setError(null);

  const value = {
    currentFolder,
    setCurrentFolder,
    isLoading,
    setIsLoading,
    error,
    setError,
    clearError,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
