import { sendMessage } from '@/utils/message';

function getAutomaScript(blockId, everyNewTab) {
  const str = `
function automaSetVariable(name, value) {
  const data = JSON.parse(sessionStorage.getItem('automa--${blockId}')) || null;

  if (data === null) return null;

  data.variables[name] = value;
  sessionStorage.setItem('automa--${blockId}', JSON.stringify(data));
}
function automaNextBlock(data, insert = true) {
  window.dispatchEvent(new CustomEvent('__automa-next-block__', { detail: { data, insert } }));
}
function automaResetTimeout() {
 window.dispatchEvent(new CustomEvent('__automa-reset-timeout__'));
}
function findData(obj, path) {
  const paths = path.split('.');
  const isWhitespace = paths.length === 1 && !/\\S/.test(paths[0]);

  if (paths.length === 0 || isWhitespace) return obj;
  else if (paths.length === 1) return obj[paths[0]];

  let result = obj;

  for (let i = 0; i < paths.length; i++) {
    if (result[paths[i]] == undefined) {
      return undefined;
    } else {
      result = result[paths[i]];
    }
  }

  return result;
}
function automaRefData(keyword, path = '') {
  const data = JSON.parse(sessionStorage.getItem('automa--${blockId}')) || null;

  if (data === null) return null;

  return findData(data[keyword], path);
}
  `;

  if (everyNewTab) return '';

  return str;
}

function javascriptCode(block) {
  if (!block.data.everyNewTab)
    sessionStorage.setItem(
      `automa--${block.id}`,
      JSON.stringify(block.refData)
    );
  const automaScript = getAutomaScript(block.id, block.data.everyNewTab);

  return new Promise((resolve, reject) => {
    let documentCtx = document;

    if (block.frameSelector) {
      const iframeCtx = document.querySelector(
        block.frameSelector
      )?.contentDocument;

      if (!iframeCtx) {
        reject(new Error('iframe-not-found'));
        return;
      }

      documentCtx = iframeCtx;
    }

    const scriptAttr = `block--${block.id}`;
    const isScriptExists = documentCtx.querySelector(
      `.automa-custom-js[${scriptAttr}]`
    );

    if (isScriptExists) {
      resolve('');
      return;
    }

    const promisePreloadScripts =
      block.data?.preloadScripts.map(async (item) => {
        try {
          const { protocol, pathname } = new URL(item.src);
          const isValidUrl = /https?/.test(protocol) && /\.js$/.test(pathname);

          if (!isValidUrl) return null;

          const script = await sendMessage(
            'fetch:text',
            item.src,
            'background'
          );
          const scriptEl = documentCtx.createElement('script');

          scriptEl.type = 'text/javascript';
          scriptEl.innerHTML = script;

          return {
            ...item,
            script: scriptEl,
          };
        } catch (error) {
          return null;
        }
      }) || [];

    Promise.allSettled(promisePreloadScripts).then((result) => {
      const preloadScripts = result.reduce((acc, { status, value }) => {
        if (status !== 'fulfilled' || !value) return acc;

        acc.push(value);
        documentCtx.body.appendChild(value.script);

        return acc;
      }, []);

      const script = document.createElement('script');

      script.setAttribute(scriptAttr, '');
      script.classList.add('automa-custom-js');
      script.innerHTML = `(() => {
        ${automaScript}

        try {
          ${block.data.code}
        } catch (error) {
          console.error(error);
          automaNextBlock({ $error: true, message: error.message });
        }
      })()`;

      if (!block.data.everyNewTab) {
        let timeout;
        const cleanUp = (columns = {}) => {
          const storageKey = `automa--${block.id}`;
          const storageRefData = JSON.parse(sessionStorage.getItem(storageKey));

          script.remove();
          preloadScripts.forEach((item) => {
            if (item.removeAfterExec) item.script.remove();
          });

          resolve({ columns, variables: storageRefData?.variables });
        };

        window.addEventListener('__automa-next-block__', ({ detail }) => {
          clearTimeout(timeout);
          cleanUp(detail || {});
        });
        window.addEventListener('__automa-reset-timeout__', () => {
          clearTimeout(timeout);

          timeout = setTimeout(cleanUp, block.data.timeout);
        });

        timeout = setTimeout(cleanUp, block.data.timeout);
      } else {
        resolve();
      }

      documentCtx.body.appendChild(script);
    });
  });
}

export default javascriptCode;
