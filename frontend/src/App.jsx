import React from 'react';
import { AppProvider } from './context/AppContext';
import { NotesProvider } from './context/NotesContext';
import { SelectionProvider } from './context/SelectionContext';
import { TranscriptionJobsProvider } from './context/TranscriptionJobsContext';
import Layout from './components/layout/Layout';

function App() {
  return (
    <AppProvider>
      <SelectionProvider>
        <NotesProvider>
          <TranscriptionJobsProvider>
            <Layout />
          </TranscriptionJobsProvider>
        </NotesProvider>
      </SelectionProvider>
    </AppProvider>
  );
}

export default App;
