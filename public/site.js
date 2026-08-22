// Background videos: mount the embed, but only fade it in once it is really
// playing so the fallback still stays visible if the embed is blocked.
(function () {
  var hosts = document.querySelectorAll('.section-bg[data-bg-video-id]');
  if (!hosts.length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ytHosts = [];

  hosts.forEach(function (host) {
    var provider = host.getAttribute('data-bg-video-provider');
    var id = host.getAttribute('data-bg-video-id');
    if (provider === 'vimeo') {
      var f = document.createElement('iframe');
      f.className = 'bg-video';
      f.title = 'Background video';
      f.tabIndex = -1;
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('frameborder', '0');
      f.setAttribute('allow', 'autoplay');
      f.src = 'https://player.vimeo.com/video/' + encodeURIComponent(id) +
        '?background=1&autoplay=1&loop=1&muted=1';
      f.addEventListener('load', function () { host.classList.add('bg-video-ready'); });
      host.appendChild(f);
    } else if (provider === 'youtube') {
      var mount = document.createElement('div');
      mount.className = 'bg-video';
      mount.setAttribute('aria-hidden', 'true');
      host.appendChild(mount);
      ytHosts.push({ host: host, mount: mount, id: id });
    }
  });

  if (!ytHosts.length) return;

  window.onYouTubeIframeAPIReady = function () {
    ytHosts.forEach(function (item) {
      new YT.Player(item.mount, {
        videoId: item.id,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, loop: 1, playlist: item.id,
          playsinline: 1, rel: 0, modestbranding: 1, disablekb: 1, fs: 0, iv_load_policy: 3,
        },
        events: {
          onReady: function (e) { e.target.mute(); e.target.playVideo(); },
          onStateChange: function (e) {
            if (e.data === YT.PlayerState.PLAYING) item.host.classList.add('bg-video-ready');
          },
        },
      });
    });
  };

  var s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.async = true;
  document.head.appendChild(s);
})();

// Click-to-play videos that have a custom thumbnail.
(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.video-play');
    if (!btn) return;
    var frame = document.createElement('iframe');
    frame.src = btn.getAttribute('data-video-src');
    frame.title = btn.getAttribute('aria-label') || 'Video';
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.allowFullscreen = true;
    btn.replaceWith(frame);
  });
})();

// Mobile nav toggle.
(function () {
  var burger = document.querySelector('.burger');
  var menu = document.getElementById('mobile-nav');
  if (!burger || !menu) return;

  function setOpen(open) {
    burger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  }

  burger.addEventListener('click', function () {
    setOpen(burger.getAttribute('aria-expanded') !== 'true');
  });

  menu.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') setOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });
})();
