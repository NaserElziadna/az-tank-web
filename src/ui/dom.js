/**
 * Tiny declarative DOM helper used by the UI screens — keeps screen code free
 * of repetitive `document.createElement` boilerplate without pulling in a
 * framework.
 *
 * @param {string} tag e.g. 'div', 'button.primary', 'span#title'
 * @param {object} [props] attributes; `class`, `text`, `on` (event map), style props
 * @param {(Node|string)[]} [children]
 *
 * Note: there is intentionally no raw-HTML option — text always goes through
 * `textContent`, so user-supplied content (player names) can never inject markup.
 */
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const [tagName, id] = name.split('#');
  const node = document.createElement(tagName || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v != null) node.setAttribute(k, v);
  }

  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Remove all children of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
