"""Conservative research coverage receipt; never a completeness/review assertion."""
def text_coverage(page_count, rows, successful):
    if type(page_count) is not int or not 1 <= page_count <= 1000:
        raise ValueError('Invalid original page count')
    if type(successful) is not bool or not isinstance(rows,list) or len(rows)>10000:
        raise ValueError('Invalid extraction summary')
    counts=[0]*page_count
    for row in rows:
        if not isinstance(row,dict):raise ValueError('Invalid text row')
        page=row.get('page');text=row.get('text')
        if type(page) is not int or not 1<=page<=page_count or not isinstance(text,str) or not text.strip():
            raise ValueError('Invalid page-linked text')
        counts[page-1]+=1
    missing=[i+1 for i,n in enumerate(counts) if not n]
    return {'pageCount':page_count,'pagesWithoutText':missing,
            'pageTextCounts':counts,'parserSucceeded':successful,
            'disposition':'needs_page_review' if missing or not successful else 'unreviewed_text',
            'completeExtractionVerified':False}
