export default class PromptDialog {
	constructor(props) { this.props = props }
  keyDown = ev => {
    if (ev.key !== 'Enter' || !this.props.value.trim()) return;
    this.ok();
  };
  cancel = () => { this.root.parentElement.close('cancel') };
  ok = () => { this.root.parentElement.returnDetail = this.props.value.trim(); this.root.parentElement.close('ok') };
};