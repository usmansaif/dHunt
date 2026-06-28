(function(){
  var t = localStorage.getItem('dhuntTheme') || 'system';
  document.documentElement.dataset.theme = t === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : t;
})();
