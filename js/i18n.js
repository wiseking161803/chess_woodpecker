/**
 * i18n - Internationalization for TriTueTreChess
 */
const i18n = {
    currentLang: localStorage.getItem('ttc-lang') || 'vi',

    strings: {
        vi: {
            // Login
            login_title: 'Đăng nhập',
            login_subtitle: 'TriTueTre Chess Training',
            login_username: 'Username',
            login_password: 'Password',
            login_username_ph: 'Nhập username',
            login_password_ph: 'Nhập password',
            login_btn: 'Đăng nhập',
            logout_btn: 'Đăng xuất',

            // Dashboard
            dash_title: '🧩 Bộ Puzzle của bạn',
            dash_subtitle: 'Chọn một bộ puzzle để bắt đầu luyện tập',
            dash_no_sets: 'Chưa có bộ puzzle nào được gán cho bạn',
            dash_puzzles: 'puzzles',
            dash_cycles: 'cycles đã hoàn thành',
            dash_start: 'Bắt đầu luyện tập',

            // Set detail
            detail_start_session: '▶ Bắt đầu Session',
            detail_start_cycle: '🚀 Bắt đầu Cycle',
            detail_all_done: '🎉 Hoàn thành tất cả!',
            detail_days: 'ngày',
            detail_back: '← Quay lại',
            detail_puzzles: 'puzzles',

            // Stats
            stat_overall: '📊 Hiệu suất tổng thể',
            stat_total_time: 'Tổng thời gian',
            stat_overall_ppm: 'PPM trung bình',
            stat_puzzles_min: 'puzzles/phút',
            stat_success_rate: 'Tỷ lệ đúng',
            stat_total_sessions: 'Tổng sessions',
            stat_solved_of: 'trong số',
            stat_attempted: 'đã thử',
            stat_cycle_breakdown: '📋 Chi tiết các Cycle',
            stat_no_sessions: 'Chưa có session nào',

            // Cycle / Session table
            tbl_session: 'Session',
            tbl_attempted: 'Đã thử',
            tbl_solved: 'Đã giải',
            tbl_success_rate: 'Tỷ lệ đúng',
            tbl_duration: 'Thời lượng',
            tbl_ppm: 'PPM',
            tbl_time: 'TG',
            tbl_solved_count: 'đã giải',

            // Training
            train_puzzle: 'Puzzle',
            train_cycle: 'Cycle',
            train_your_turn: 'Lượt của bạn!',
            train_your_turn_hint: 'Lượt của bạn - Hãy đi nước đi đúng!',
            train_thinking: 'Đang suy nghĩ...',
            train_correct: '✓ Đúng!',
            train_incorrect: '✗ Sai!',
            train_complete: '✓ Hoàn thành puzzle!',
            train_complete_mistakes: '✓ Puzzle hoàn thành ({0} lỗi)',
            train_wrong_retry: 'Sai! Thử lại... ({0} lỗi)',
            train_solved: 'Đã giải',
            train_accuracy: 'Chính xác',
            train_ppm: 'PPM',
            train_end_session: '⏹ Kết thúc Session',
            train_flip: 'Xoay bàn cờ',

            // Session end
            end_title: 'Kết thúc Session?',
            end_msg: 'Tiến trình sẽ được lưu lại.',
            end_cancel: 'Hủy',
            end_confirm: 'Kết thúc',

            // Session summary
            summary_title: 'Kết quả Session',
            summary_cycle_done: 'Cycle Hoàn Thành!',
            summary_session_end: 'Session Kết Thúc',
            summary_timeout: 'Hết thời gian 10 phút!',
            summary_all_solved: 'Đã giải hết tất cả puzzles trong cycle!',
            summary_ended: 'Kết thúc session',
            summary_solved: 'Đã giải',
            summary_accuracy: 'Chính xác',
            summary_ppm: 'PPM',
            summary_view_stats: 'Xem thống kê',
            summary_continue: 'Tiếp tục luyện tập',

            // Admin
            admin_title: '⚙ Quản trị',
            admin_users: '👥 Quản lý Users',
            admin_sets: '🧩 Quản lý Puzzle Sets',
            admin_create_user: '+ Tạo User',
            admin_create_set: '+ Tạo Puzzle Set',
            admin_delete_user_title: 'Xóa User?',
            admin_delete_user_msg: 'Bạn có chắc muốn xóa user này?',
            admin_delete_set_title: 'Xóa Puzzle Set?',
            admin_delete_set_msg: 'Xóa puzzle set này? Tất cả dữ liệu sẽ bị mất.',
            admin_delete: 'Xóa',
            admin_cancel: 'Hủy',
            admin_assign_title: 'Gán cho Users',
            admin_assign_select: 'Chọn users để gán thêm',
            admin_assign_btn: 'Gán',
            admin_assigned: 'đã gán',
            admin_create_set_title: 'Tạo Puzzle Set Mới',
            admin_set_name: 'Tên Set',
            admin_set_name_ph: 'Ví dụ: Tactics Level 1',
            admin_set_users: 'Gán cho Users (chọn nhiều)',
            admin_set_pgn: 'File PGN',
            admin_set_pgn_hint: 'Kéo thả file PGN hoặc click để chọn',
            admin_create: 'Tạo',
            admin_no_users: 'Chưa có user nào',
            admin_create_user_title: 'Tạo User Mới',

            // General
            loading: 'Đang tải...',
            error_unknown: 'Lỗi không xác định',
            nav_dashboard: 'Dashboard',
            nav_admin: 'Admin',

            // Dashboard set card
            cycle_badge: 'Cycle {0}',
            cycle_ready: 'Sẵn sàng Cycle {0}',

            // Leaderboard
            leaderboard_title: 'Bảng Xếp Hạng',
            leaderboard_accuracy: 'Chính xác',
            leaderboard_acc_short: 'chính xác',
            leaderboard_solved: 'đã giải',
            leaderboard_empty: 'Chưa có ai luyện tập set này',
        },
        en: {
            // Login
            login_title: 'Login',
            login_subtitle: 'TriTueTre Chess Training',
            login_username: 'Username',
            login_password: 'Password',
            login_username_ph: 'Enter username',
            login_password_ph: 'Enter password',
            login_btn: 'Login',
            logout_btn: 'Logout',

            // Dashboard
            dash_title: '🧩 Your Puzzle Sets',
            dash_subtitle: 'Select a puzzle set to start training',
            dash_no_sets: 'No puzzle sets assigned to you yet',
            dash_puzzles: 'puzzles',
            dash_cycles: 'cycles completed',
            dash_start: 'Start training',

            // Set detail
            detail_start_session: '▶ Start Session',
            detail_start_cycle: '🚀 Start Cycle',
            detail_all_done: '🎉 All completed!',
            detail_days: 'days',
            detail_back: '← Back',
            detail_puzzles: 'puzzles',

            // Stats
            stat_overall: '📊 Overall Performance',
            stat_total_time: 'Total Time',
            stat_overall_ppm: 'Overall PPM',
            stat_puzzles_min: 'puzzles/min',
            stat_success_rate: 'Success Rate',
            stat_total_sessions: 'Total Sessions',
            stat_solved_of: 'of',
            stat_attempted: 'attempted',
            stat_cycle_breakdown: '📋 Cycle Breakdown',
            stat_no_sessions: 'No sessions yet',

            // Cycle / Session table
            tbl_session: 'Session',
            tbl_attempted: 'Attempted',
            tbl_solved: 'Solved',
            tbl_success_rate: 'Success Rate',
            tbl_duration: 'Duration',
            tbl_ppm: 'PPM',
            tbl_time: 'TIME',
            tbl_solved_count: 'solved',

            // Training
            train_puzzle: 'Puzzle',
            train_cycle: 'Cycle',
            train_your_turn: 'Your turn!',
            train_your_turn_hint: 'Your turn - Make the correct move!',
            train_thinking: 'Thinking...',
            train_correct: '✓ Correct!',
            train_incorrect: '✗ Wrong!',
            train_complete: '✓ Puzzle complete!',
            train_complete_mistakes: '✓ Puzzle done ({0} mistakes)',
            train_wrong_retry: 'Wrong! Try again... ({0} mistakes)',
            train_solved: 'Solved',
            train_accuracy: 'Accuracy',
            train_ppm: 'PPM',
            train_end_session: '⏹ End Session',
            train_flip: 'Flip board',

            // Session end
            end_title: 'End Session?',
            end_msg: 'Your progress will be saved.',
            end_cancel: 'Cancel',
            end_confirm: 'End',

            // Session summary
            summary_title: 'Session Results',
            summary_cycle_done: 'Cycle Complete!',
            summary_session_end: 'Session Ended',
            summary_timeout: 'Time\'s up (10 minutes)!',
            summary_all_solved: 'All puzzles solved in this cycle!',
            summary_ended: 'Session ended',
            summary_solved: 'Solved',
            summary_accuracy: 'Accuracy',
            summary_ppm: 'PPM',
            summary_view_stats: 'View Stats',
            summary_continue: 'Continue Training',

            // Admin
            admin_title: '⚙ Administration',
            admin_users: '👥 User Management',
            admin_sets: '🧩 Puzzle Set Management',
            admin_create_user: '+ Create User',
            admin_create_set: '+ Create Puzzle Set',
            admin_delete_user_title: 'Delete User?',
            admin_delete_user_msg: 'Are you sure you want to delete this user?',
            admin_delete_set_title: 'Delete Puzzle Set?',
            admin_delete_set_msg: 'Delete this puzzle set? All data will be lost.',
            admin_delete: 'Delete',
            admin_cancel: 'Cancel',
            admin_assign_title: 'Assign to Users',
            admin_assign_select: 'Select users to assign',
            admin_assign_btn: 'Assign',
            admin_assigned: 'assigned',
            admin_create_set_title: 'Create New Puzzle Set',
            admin_set_name: 'Set Name',
            admin_set_name_ph: 'e.g. Tactics Level 1',
            admin_set_users: 'Assign to Users (multi-select)',
            admin_set_pgn: 'PGN File',
            admin_set_pgn_hint: 'Drag & drop PGN file or click to select',
            admin_create: 'Create',
            admin_no_users: 'No users yet',
            admin_create_user_title: 'Create New User',

            // General
            loading: 'Loading...',
            error_unknown: 'Unknown error',
            nav_dashboard: 'Dashboard',
            nav_admin: 'Admin',

            // Dashboard set card
            cycle_badge: 'Cycle {0}',
            cycle_ready: 'Ready for Cycle {0}',

            // Leaderboard
            leaderboard_title: 'Leaderboard',
            leaderboard_accuracy: 'Accuracy',
            leaderboard_acc_short: 'accuracy',
            leaderboard_solved: 'solved',
            leaderboard_empty: 'No one has trained this set yet',
        }
    },

    t(key, ...args) {
        let str = this.strings[this.currentLang]?.[key] || this.strings['vi'][key] || key;
        args.forEach((arg, i) => {
            str = str.replace(`{${i}}`, arg);
        });
        return str;
    },

    setLang(lang) {
        this.currentLang = lang;
        localStorage.setItem('ttc-lang', lang);
    }
};
