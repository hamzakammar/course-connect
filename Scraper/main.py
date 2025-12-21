import json
import uwflow_api
from dataclasses import asdict

def main():
    with open('nodes.json', 'r') as f:
        nodes = json.load(f)
    with open('courses.jsonl', 'w') as f:
        for node in nodes:
            course_code = node['id']
            print(course_code)

            course = uwflow_api.fetch_course(course_code)
            if course:  # Only write if course was found
                # Convert dataclass to dict, then write as JSONL
                f.write(json.dumps(asdict(course), ensure_ascii=False) + '\n')
if __name__ == "__main__":
    main()