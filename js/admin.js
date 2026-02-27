/**
 * Admin Panel - CRUD operations for courses and chapters
 */

class Admin {
    constructor(courseManager) {
        this.cm = courseManager;
        this.editingCourseId = null;
    }

    // ===== COURSE MANAGEMENT =====

    async renderCourseList() {
        await this.cm.fetchCourses();
        const list = document.getElementById('admin-course-list');

        if (this.cm.courses.length === 0) {
            list.innerHTML = `
                <div class="admin-empty">
                    <p>Chưa có khóa học nào. Hãy tạo khóa học đầu tiên!</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.cm.courses.map(course => `
            <div class="admin-item">
                <div class="admin-item-icon">${course.icon || '♞'}</div>
                <div class="admin-item-info">
                    <div class="admin-item-name">${course.name}</div>
                    <div class="admin-item-meta">${course.description || 'Chưa có mô tả'} · ${course.chapters.length} chương</div>
                </div>
                <div class="admin-item-actions">
                    <button class="btn btn-sm btn-secondary" onclick="admin.manageChapters('${course.id}')">📑 Chương</button>
                    <button class="btn btn-sm btn-secondary" onclick="admin.showCourseForm('${course.id}')">✏ Sửa</button>
                    <button class="btn btn-sm btn-ghost" onclick="admin.deleteCourse('${course.id}')" style="color:var(--danger)">🗑</button>
                </div>
            </div>
        `).join('');
    }

    showCourseForm(courseId = null) {
        const course = courseId ? this.cm.getCourse(courseId) : null;
        const title = course ? 'Sửa khóa học' : 'Tạo khóa học mới';

        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = `
            <form id="course-form" class="admin-form">
                <div class="form-group">
                    <label>Tên khóa học</label>
                    <input type="text" id="form-course-name" value="${course ? course.name : ''}" placeholder="Ví dụ: Khai cuộc Tứ Mã" required>
                </div>
                <div class="form-group">
                    <label>Mô tả</label>
                    <textarea id="form-course-desc" rows="3" placeholder="Mô tả ngắn về khóa học...">${course ? course.description : ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Icon (emoji)</label>
                    <input type="text" id="form-course-icon" value="${course ? course.icon : '♞'}" maxlength="2" style="width:60px;text-align:center;font-size:1.5rem;">
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal()">Hủy</button>
                    <button type="submit" class="btn btn-primary">${course ? 'Lưu' : 'Tạo'}</button>
                </div>
            </form>
        `;

        document.getElementById('course-form').onsubmit = async (e) => {
            e.preventDefault();
            const data = {
                name: document.getElementById('form-course-name').value,
                description: document.getElementById('form-course-desc').value,
                icon: document.getElementById('form-course-icon').value || '♞'
            };

            if (course) {
                await this.cm.updateCourse(courseId, data);
                app.showToast('Đã cập nhật khóa học', 'success');
            } else {
                await this.cm.createCourse(data);
                app.showToast('Đã tạo khóa học mới', 'success');
            }

            app.closeModal();
            this.renderCourseList();
            await this.cm.fetchCourses();
        };

        app.openModal();
    }

    async deleteCourse(courseId) {
        const course = this.cm.getCourse(courseId);
        if (!confirm(`Xóa khóa học "${course.name}"? Tất cả chương và file PGN sẽ bị xóa.`)) return;

        await this.cm.deleteCourse(courseId);
        this.cm.sr.removeCardsForCourse(courseId);
        app.showToast('Đã xóa khóa học', 'info');
        this.renderCourseList();
        document.getElementById('admin-chapters-section').style.display = 'none';
        await this.cm.fetchCourses();
    }

    // ===== CHAPTER MANAGEMENT =====

    async manageChapters(courseId) {
        this.editingCourseId = courseId;
        const course = this.cm.getCourse(courseId);
        if (!course) return;

        document.getElementById('admin-chapters-title').textContent = `Chương trong "${course.name}"`;
        document.getElementById('admin-chapters-section').style.display = 'block';

        this.renderChapterList(course);
    }

    renderChapterList(course) {
        const list = document.getElementById('admin-chapter-list');

        if (course.chapters.length === 0) {
            list.innerHTML = `
                <div class="admin-empty">
                    <p>Chưa có chương nào. Upload file PGN để thêm chương!</p>
                </div>
            `;
            return;
        }

        list.innerHTML = course.chapters.map(chapter => `
            <div class="admin-item">
                <div class="admin-item-icon">📄</div>
                <div class="admin-item-info">
                    <div class="admin-item-name">${chapter.name}</div>
                    <div class="admin-item-meta">${chapter.originalName || 'N/A'} · ${chapter.lineCount || 0} biến</div>
                </div>
                <div class="admin-item-actions">
                    <button class="btn btn-sm btn-secondary" onclick="admin.showChapterForm('${chapter.id}')">✏ Sửa</button>
                    <button class="btn btn-sm btn-ghost" onclick="admin.deleteChapter('${chapter.id}')" style="color:var(--danger)">🗑</button>
                </div>
            </div>
        `).join('');
    }

    showChapterForm(chapterId = null) {
        if (!this.editingCourseId) return;

        const course = this.cm.getCourse(this.editingCourseId);
        const chapter = chapterId ? course.chapters.find(ch => ch.id === chapterId) : null;
        const title = chapter ? 'Sửa chương' : 'Thêm chương mới';

        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = `
            <form id="chapter-form" class="admin-form">
                <div class="form-group">
                    <label>Tên chương</label>
                    <input type="text" id="form-chapter-name" value="${chapter ? chapter.name : ''}" placeholder="Ví dụ: Sidelines Set 2.1">
                </div>
                <div class="form-group">
                    <label>File PGN ${chapter ? '(để trống nếu không thay đổi)' : ''}</label>
                    <div class="file-upload-area" id="file-upload-area">
                        <input type="file" id="form-chapter-pgn" accept=".pgn" ${chapter ? '' : 'required'}>
                        <div class="file-upload-label">
                            <span class="file-upload-icon">📁</span>
                            <span>Kéo thả file PGN hoặc click để chọn</span>
                        </div>
                    </div>
                    ${chapter ? `<div class="form-hint">File hiện tại: ${chapter.originalName}</div>` : ''}
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal()">Hủy</button>
                    <button type="submit" class="btn btn-primary">${chapter ? 'Lưu' : 'Tạo'}</button>
                </div>
            </form>
        `;

        document.getElementById('chapter-form').onsubmit = async (e) => {
            e.preventDefault();
            const name = document.getElementById('form-chapter-name').value;
            const fileInput = document.getElementById('form-chapter-pgn');
            const file = fileInput.files[0];

            if (chapter) {
                await this.cm.updateChapter(chapterId, name || chapter.name, file || null);
                if (file) this.cm.clearPGNCache(chapterId);
                app.showToast('Đã cập nhật chương', 'success');
            } else {
                if (!file) {
                    app.showToast('Cần chọn file PGN', 'error');
                    return;
                }
                await this.cm.createChapter(this.editingCourseId, name || file.name.replace('.pgn', ''), file);
                app.showToast('Đã thêm chương mới', 'success');
            }

            app.closeModal();
            await this.cm.fetchCourses();
            const updatedCourse = this.cm.getCourse(this.editingCourseId);
            this.renderChapterList(updatedCourse);
        };

        app.openModal();
    }

    async deleteChapter(chapterId) {
        if (!confirm('Xóa chương này? File PGN và tiến độ học sẽ bị xóa.')) return;

        await this.cm.deleteChapter(chapterId);
        this.cm.sr.removeCardsForChapter(this.editingCourseId, chapterId);
        this.cm.clearPGNCache(chapterId);
        app.showToast('Đã xóa chương', 'info');

        await this.cm.fetchCourses();
        const course = this.cm.getCourse(this.editingCourseId);
        this.renderChapterList(course);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Admin;
}
