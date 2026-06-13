function toggleCodeBlock(button) {
    const wrapper = button.closest('.collapsible-code');
    const isExpanded = wrapper.classList.toggle('expanded');

    button.innerText = isExpanded ? 'Show Less' : 'Show More';

    if (!isExpanded) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('.collapsible-code').forEach(wrapper => {
        const content = wrapper.querySelector('.code-block-content');
        const button = wrapper.querySelector('.show-more-btn');

        if (content.scrollHeight > 350) {
            button.style.display = 'block';
        }
    });
});
