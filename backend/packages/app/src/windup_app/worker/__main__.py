"""Worker 进程入口：``python -m windup_app.worker``。"""

from windup_app.worker.bootstrap import main

if __name__ == "__main__":
    main()
