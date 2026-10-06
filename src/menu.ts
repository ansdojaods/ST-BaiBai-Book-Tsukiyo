import { openBook } from '@/state/ui';
import { toggleMemoryEditorPanel } from '@/features/memory-editor/host';

const MENU_ITEM_ID = 'bbs-menu-item';
const MENU_EDITOR_ID = 'bbs-menu-editor-item';

/**
 * 往 ST 的 #extensionsMenu(魔杖菜单)末尾注入"柏宝书"入口。
 * 菜单是懒加载的,用轮询等它出现;注入一次即可。
 */
export function injectMenuButton() {
  const tryInject = () => {
    const $menu = $('#extensionsMenu');
    if ($menu.length === 0) return false;
    if ($(`#${MENU_ITEM_ID}`).length > 0) return true;

    const $item = $(`
      <div class="extension_container interactable" tabindex="0">
        <a id="${MENU_ITEM_ID}" class="list-group-item" href="#" title="百宝月夜书">
          <i class="fa-solid fa-book-bookmark"></i>
          <span>百宝月夜书</span>
        </a>
      </div>
    `);

    $item.on('click', (e: { preventDefault: () => void }) => {
      e.preventDefault();
      openBook();
      // 点击后收起魔杖菜单,贴合原生行为
      $('#extensionsMenu').hide();
    });

    $menu.append($item);

    // 【1.4.0】剧情剪辑台开合入口
    const $editor = $(`
      <div class="extension_container interactable" tabindex="0">
        <a id="${MENU_EDITOR_ID}" class="list-group-item" href="#" title="剧情剪辑台（楼层摘要 / 状态账本 / 召回）">
          <i class="fa-solid fa-clapperboard"></i>
          <span>剧情剪辑台</span>
        </a>
      </div>
    `);
    $editor.on('click', (e: { preventDefault: () => void }) => {
      e.preventDefault();
      toggleMemoryEditorPanel();
      $('#extensionsMenu').hide();
    });
    $menu.append($editor);
    return true;
  };

  if (tryInject()) return;
  const timer = setInterval(() => {
    if (tryInject()) clearInterval(timer);
  }, 500);
}
