import {useState, useEffect} from 'react';

const useDarkMode = () => {
  const {nativeTheme} = require('../utils/electron-remote');
  const [isDarkMode, setIsDarkMode] = useState(nativeTheme.shouldUseDarkColors);

  useEffect(() => {
    const updateDarkMode = () => {
      setIsDarkMode(nativeTheme.shouldUseDarkColors);
    };

    nativeTheme.on('updated', updateDarkMode);
    return () => nativeTheme.off('updated', updateDarkMode);
  }, []);

  return isDarkMode;
};

export default useDarkMode;
